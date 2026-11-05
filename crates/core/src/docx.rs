//! Word export. With a template, the document is written *into* a copy of the
//! `.docx`: only the marked place in `word/document.xml` changes, plus the
//! parts that new content needs, so cover pages, headers, fonts and styles
//! survive untouched.

mod detect;

use crate::{Error, Result};
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use regex::{Captures, Regex};
use std::collections::{BTreeMap, HashMap};
use std::io::{Cursor, Read, Write};
use std::sync::LazyLock;

const DOCUMENT: &str = "word/document.xml";
const STYLES: &str = "word/styles.xml";
const SETTINGS: &str = "word/settings.xml";
const NUMBERING: &str = "word/numbering.xml";
const FOOTNOTES: &str = "word/footnotes.xml";
const DOC_RELS: &str = "word/_rels/document.xml.rels";
const CONTENT_TYPES: &str = "[Content_Types].xml";

const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// EMU per twip and per CSS pixel, Word's and the web's units.
const EMU_PER_TWIP: u64 = 635;
const EMU_PER_PX: u64 = 9525;
/// A4 with 2.5 cm margins, for templates that state no section size.
const DEFAULT_TEXT_WIDTH: u64 = 9026;
/// Diagrams are rasterised at twice their size so they print sharply.
const DIAGRAM_SCALE: u64 = 2;
const CODE_FONT: &str = "Consolas";
const MAX_LEVELS: usize = 6;
/// Word's space around the text of a table cell, in twentieths of a point.
const CELL_SPACING: &str = r#"<w:spacing w:before="40" w:after="40"/>"#;

macro_rules! re {
    ($name:ident, $pattern:literal) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pattern).expect("valid pattern"));
    };
}

re!(PARAGRAPH, r"(?s)<w:p(?: [^>]*[^/])?>.*?</w:p>");
re!(TEXT, r"(?s)<w:t(?: [^>]*)?>(.*?)</w:t>");
re!(PARAGRAPH_STYLE, r#"<w:pStyle w:val="([^"]*)""#);
re!(PLACEHOLDER, r"\{\{\s*([^{}]+?)\s*\}\}");
re!(STYLE, r"(?s)<w:style [^>]*>.*?</w:style>");
re!(STYLE_ID, r#"w:styleId="([^"]*)""#);
re!(STYLE_NAME, r#"<w:name w:val="([^"]*)""#);
re!(PAGE_SIZE, r#"<w:pgSz [^>]*w:w="(\d+)""#);
re!(PAGE_MARGIN_L, r#"<w:pgMar [^>]*w:left="(\d+)""#);
re!(PAGE_MARGIN_R, r#"<w:pgMar [^>]*w:right="(\d+)""#);
re!(ABSTRACT_ID, r#"w:abstractNumId="(\d+)""#);
re!(NUM_ID, r#"<w:num [^>]*w:numId="(\d+)""#);
re!(FOOTNOTE_ID, r#"<w:footnote [^>]*w:id="(-?\d+)""#);
re!(UPDATE_FIELDS, r"<w:updateFields\b[^>]*/>");
re!(TOC_INSTR, r"(?s)<w:instrText[^>]*>\s*TOC\b(.*?)</w:instrText>");
re!(TOC_LEVELS, r#"\\o\s+(?:&quot;|")(\d)-(\d)(?:&quot;|")"#);
re!(TOC_STYLES, r#"\\t\s+(?:&quot;|")(.*?)(?:&quot;|")"#);
re!(WIKI_EMBED, r"!\[\[([^\]|#]+)[^\]]*\]\]");
re!(WIKI_LINK, r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]");
re!(FRONTMATTER, r"(?s)\A---\r?\n(.*?)\r?\n---(?:\r?\n|\z)");

/// One piece of an exported document, shared by the Word and PDF writers.
#[derive(Debug, Clone)]
pub enum Section {
    /// A folder or note name turned into a title.
    Heading {
        text: String,
        /// Word style id. None uses the template's heading for `level`.
        style: Option<String>,
        level: usize,
        page_break: bool,
    },
    Note {
        path: String,
        markdown: String,
        /// Levels to push the note's own headings down.
        shift: usize,
        page_break: bool,
    },
}

pub struct Input<'a> {
    pub sections: &'a [Section],
    /// Used for `{{titulo}}` when no note gives a better one.
    pub title: &'a str,
    /// Use `title` over anything in the notes, as for a folder or vault.
    pub fixed_title: bool,
    pub date: &'a str,
    /// The title of the contents, for `{{indice}}` in the language of the app.
    pub contents: &'a str,
    /// Rendered diagrams as PNG, in the order they appear. Empty if rendering failed.
    pub diagrams: &'a [Vec<u8>],
    /// Loads an image: note path, then the reference written in it.
    pub image: &'a dyn Fn(&str, &str) -> Option<Vec<u8>>,
    pub template: Option<&'a [u8]>,
}

fn invalid(what: &str) -> Error {
    Error::Vault(format!("not a usable Word document: {what}"))
}

pub(crate) type Package = BTreeMap<String, Vec<u8>>;

pub(crate) fn read_package(bytes: &[u8]) -> Result<Package> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid("not a .docx"))?;
    let mut parts = Package::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|_| invalid("damaged archive"))?;
        if file.is_dir() {
            continue;
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(|_| invalid("damaged archive"))?;
        let name = file.name().map_err(|_| invalid("damaged archive"))?.into_owned();
        parts.insert(name, data);
    }
    if !parts.contains_key(DOCUMENT) || !parts.contains_key(CONTENT_TYPES) {
        return Err(invalid("no document part"));
    }
    Ok(parts)
}

fn write_package(parts: &Package) -> Result<Vec<u8>> {
    let mut out = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let failed = |e: zip::result::ZipError| Error::Vault(e.to_string());
    // Consumers expect the content types first.
    let names = std::iter::once(CONTENT_TYPES).chain(parts.keys().map(String::as_str).filter(|n| *n != CONTENT_TYPES));
    for name in names {
        out.start_file(name, options).map_err(failed)?;
        out.write_all(&parts[name])?;
    }
    Ok(out.finish().map_err(failed)?.into_inner())
}

/// Checks that a file can serve as a template.
pub fn check_template(bytes: &[u8]) -> Result<()> {
    let parts = read_package(bytes)?;
    let document = String::from_utf8_lossy(&parts[DOCUMENT]);
    if document.contains("<w:body") { Ok(()) } else { Err(invalid("no document body")) }
}

fn text_of(parts: &Package, name: &str) -> Option<String> {
    parts.get(name).map(|b| String::from_utf8_lossy(b).into_owned())
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Styles by their canonical lowercase name. The id cannot be used: in a Spanish
/// Word, "heading 1" has the id `Ttulo1`, while its name stays the same.
struct Styles(HashMap<String, String>);

impl Styles {
    fn parse(xml: &str) -> Self {
        let mut map = HashMap::new();
        for style in STYLE.find_iter(xml).map(|m| m.as_str()) {
            if let (Some(id), Some(name)) = (STYLE_ID.captures(style), STYLE_NAME.captures(style)) {
                map.insert(name[1].to_lowercase(), id[1].to_string());
            }
        }
        Self(map)
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(String::as_str)
    }

    fn paragraph(&self, name: &str) -> String {
        self.get(name).map_or(String::new(), |id| format!(r#"<w:pStyle w:val="{id}"/>"#))
    }

    fn superscript(&self) -> String {
        self.get("footnote reference")
            .map_or(r#"<w:vertAlign w:val="superscript"/>"#.to_string(), |id| format!(r#"<w:rStyle w:val="{id}"/>"#))
    }
}

pub fn split_frontmatter(markdown: &str) -> (HashMap<String, String>, &str) {
    let Some(found) = FRONTMATTER.captures(markdown) else {
        return (HashMap::new(), markdown);
    };
    let meta = found[1]
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().trim_matches(['"', '\'']).to_string()))
        .collect();
    (meta, &markdown[found[0].len()..])
}

/// Turns Obsidian-style links, which CommonMark does not know, into standard ones.
pub fn normalize_wikilinks(markdown: &str) -> String {
    let embeds = WIKI_EMBED.replace_all(markdown, |c: &Captures| format!("![]({})", c[1].trim().replace(' ', "%20")));
    WIKI_LINK
        .replace_all(&embeds, |c: &Captures| c.get(2).map_or(&c[1], |m| m.as_str()).trim().to_string())
        .into_owned()
}

#[derive(Default, Clone, Copy)]
struct Format {
    bold: bool,
    italic: bool,
    strike: bool,
}

struct Heading {
    level: usize,
    text: String,
}

/// A table under construction. `body` holds the document written so far, while
/// `Writer::out` collects one cell at a time.
#[derive(Default)]
struct Table {
    body: String,
    columns: usize,
    rows: String,
    row: String,
    head: bool,
}

struct Writer<'a> {
    styles: &'a Styles,
    input: &'a Input<'a>,
    text_width_emu: u64,
    out: String,
    /// The paragraph being written: its properties and its runs.
    para: Option<(String, String)>,
    format: Format,
    link: Option<String>,
    rels: Vec<String>,
    media: Vec<(String, Vec<u8>)>,
    headings: Vec<Heading>,
    heading: Option<Heading>,
    next_diagram: usize,
    drawing_id: u32,
    code: Option<(String, String)>,
    /// Inside an image, whose alt text arrives as text events.
    in_image: bool,
    lists: Vec<Option<i64>>,
    next_num: i64,
    /// Numbering instances to create, and whether each is ordered.
    nums: Vec<(i64, bool)>,
    item_marker: Option<(i64, usize)>,
    next_abstract: i64,
    quote: usize,
    footnote_ids: HashMap<String, i64>,
    next_footnote: i64,
    footnotes: String,
    /// The next paragraph opens a footnote and carries its reference mark.
    footnote_start: bool,
    /// The next paragraph starts a new page.
    page_break: bool,
    note: String,
    note_index: usize,
    shift: usize,
    table: Option<Table>,
    /// The table style formats its first row, so the header needs no bold of its own.
    styled_header: bool,
    /// The template's own styles.
    detected: detect::Detected,
}

impl Writer<'_> {
    /// The style id for a heading level: the template's own, or the standard one.
    fn heading_style(&self, level: usize) -> Option<String> {
        let own = self.detected.headings.get(level.wrapping_sub(1)).cloned().flatten();
        own.or_else(|| self.styles.get(&format!("heading {level}")).map(String::from))
    }

    /// The paragraph properties of the template's body text, if it has its own.
    fn body_style(&self) -> String {
        self.detected.body.as_ref().map_or(String::new(), |id| format!(r#"<w:pStyle w:val="{id}"/>"#))
    }

    fn open(&mut self, properties: String) {
        self.flush();
        let properties = if std::mem::take(&mut self.page_break) {
            // Schema order: the style first, then the break, then the rest.
            let end = if properties.starts_with("<w:pStyle") { properties.find("/>").map_or(0, |i| i + 2) } else { 0 };
            format!("{}<w:pageBreakBefore/>{}", &properties[..end], &properties[end..])
        } else {
            properties
        };
        self.para = Some((properties, String::new()));
        if self.footnote_start {
            self.footnote_start = false;
            let style = self.styles.superscript();
            self.push_raw(&format!("<w:r><w:rPr>{style}</w:rPr><w:footnoteRef/></w:r>"));
        }
    }

    fn flush(&mut self) {
        if let Some((properties, runs)) = self.para.take() {
            let properties = if properties.is_empty() { String::new() } else { format!("<w:pPr>{properties}</w:pPr>") };
            self.out.push_str(&format!("<w:p>{properties}{runs}</w:p>"));
        }
    }

    fn body_properties(&mut self) -> String {
        if let Some((num, level)) = self.item_marker.take() {
            let style = self.list_style();
            return format!(r#"{style}<w:numPr><w:ilvl w:val="{level}"/><w:numId w:val="{num}"/></w:numPr>"#);
        }
        if self.quote > 0 {
            let style = self.styles.paragraph("quote");
            return if style.is_empty() { r#"<w:ind w:left="567"/>"#.to_string() } else { style };
        }
        if !self.lists.is_empty() {
            let indent = 360 * (self.lists.len() + 1);
            return format!(r#"{}<w:ind w:left="{indent}"/>"#, self.list_style());
        }
        if self.footnote_start {
            return self.styles.paragraph("footnote text");
        }
        self.body_style()
    }

    fn list_style(&self) -> String {
        let body = self.body_style();
        if body.is_empty() { self.styles.paragraph("list paragraph") } else { body }
    }

    fn push_raw(&mut self, xml: &str) {
        if self.para.is_none() {
            let properties = self.body_properties();
            self.open(properties);
        }
        if let Some((_, runs)) = &mut self.para {
            runs.push_str(xml);
        }
    }

    fn run_properties(&self, code: bool) -> String {
        let mut p = String::new();
        if self.link.is_some()
            && let Some(id) = self.styles.get("hyperlink")
        {
            p.push_str(&format!(r#"<w:rStyle w:val="{id}"/>"#));
        }
        if code {
            p.push_str(&format!(r#"<w:rFonts w:ascii="{CODE_FONT}" w:hAnsi="{CODE_FONT}" w:cs="{CODE_FONT}"/>"#));
        }
        if self.format.bold {
            p.push_str("<w:b/>");
        }
        if self.format.italic {
            p.push_str("<w:i/>");
        }
        if self.format.strike {
            p.push_str("<w:strike/>");
        }
        if self.link.is_some() && self.styles.get("hyperlink").is_none() {
            p.push_str(r#"<w:color w:val="0563C1"/><w:u w:val="single"/>"#);
        }
        if p.is_empty() { p } else { format!("<w:rPr>{p}</w:rPr>") }
    }

    fn push_text(&mut self, text: &str, code: bool) {
        if let Some(h) = &mut self.heading {
            h.text.push_str(text);
        }
        let run = format!(r#"<w:r>{}<w:t xml:space="preserve">{}</w:t></w:r>"#, self.run_properties(code), escape(text));
        match &self.link {
            Some(rel) => {
                let wrapped = format!(r#"<w:hyperlink r:id="{rel}">{run}</w:hyperlink>"#);
                self.push_raw(&wrapped);
            }
            None => self.push_raw(&run),
        }
    }

    fn add_rel(&mut self, kind: &str, target: &str, external: bool) -> String {
        let id = format!("rIdUmd{}", self.rels.len() + 1);
        let mode = if external { r#" TargetMode="External""# } else { "" };
        self.rels.push(format!(
            r#"<Relationship Id="{id}" Type="{REL_NS}/{kind}" Target="{}"{mode}/>"#,
            escape(target)
        ));
        id
    }

    fn push_picture(&mut self, bytes: Vec<u8>, alt: &str, scale: u64) -> bool {
        let (Ok(size), Ok(kind)) = (imagesize::blob_size(&bytes), imagesize::image_type(&bytes)) else {
            return false;
        };
        let ext = match kind {
            imagesize::ImageType::Png => "png",
            imagesize::ImageType::Jpeg => "jpeg",
            imagesize::ImageType::Gif => "gif",
            _ => return false,
        };
        let name = format!("media/umd{}.{ext}", self.media.len() + 1);
        let rel = self.add_rel("image", &name, false);
        self.media.push((format!("word/{name}"), bytes));

        let mut cx = size.width as u64 * EMU_PER_PX / scale;
        let mut cy = size.height as u64 * EMU_PER_PX / scale;
        if cx > self.text_width_emu {
            cy = cy * self.text_width_emu / cx;
            cx = self.text_width_emu;
        }
        self.drawing_id += 1;
        let id = self.drawing_id;
        let alt = escape(alt);
        self.push_raw(&format!(
            concat!(
                r#"<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">"#,
                r#"<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{id}" name="Imagen {id}" descr="{alt}"/>"#,
                r#"<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">"#,
                r#"<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="{id}" name="Imagen {id}"/><pic:cNvPicPr/></pic:nvPicPr>"#,
                r#"<pic:blipFill><a:blip xmlns:r="{ns}" r:embed="{rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>"#,
                r#"<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>"#,
                r#"</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
            ),
            cx = cx,
            cy = cy,
            id = id,
            alt = alt,
            ns = REL_NS,
            rel = rel,
        ));
        true
    }

    fn push_code_block(&mut self, language: &str, code: &str) {
        self.flush();
        if language == "mermaid" || language == "d2" {
            let png = self.input.diagrams.get(self.next_diagram).cloned().unwrap_or_default();
            self.next_diagram += 1;
            self.open(r#"<w:jc w:val="center"/>"#.to_string());
            if !self.push_picture(png, "Diagrama", DIAGRAM_SCALE) {
                self.push_text("[Diagrama no disponible]", false);
            }
            self.flush();
            return;
        }
        self.open(r#"<w:shd w:val="clear" w:color="auto" w:fill="F3F1EA"/>"#.to_string());
        for (i, line) in code.trim_end_matches('\n').split('\n').enumerate() {
            if i > 0 {
                self.push_raw("<w:r><w:br/></w:r>");
            }
            self.push_text(line, true);
        }
        self.flush();
    }

    /// A title that comes from the export plan rather than from a note.
    fn section_heading(&mut self, text: &str, style: Option<&str>, level: usize, page_break: bool) {
        self.flush();
        self.page_break = page_break;
        let level = level.clamp(1, MAX_LEVELS);
        let id = style.map(String::from).or_else(|| self.heading_style(level));
        let is_heading = id.as_deref().is_some_and(|id| self.styles.0.iter().any(|(name, v)| v == id && name.starts_with("heading ")));
        let outline = if is_heading { String::new() } else { format!(r#"<w:outlineLvl w:val="{}"/>"#, level - 1) };
        let style = id.as_ref().map_or(String::new(), |id| format!(r#"<w:pStyle w:val="{id}"/>"#));
        self.open(format!("{style}{outline}"));
        self.format.bold = id.is_none();
        self.heading = Some(Heading { level, text: String::new() });
        self.push_text(text, false);
        self.flush();
        self.format.bold = false;
        if let Some(h) = self.heading.take() {
            self.headings.push(h);
        }
    }

    fn start_list(&mut self, first: Option<u64>) {
        self.flush();
        if first.is_some() {
            // Each ordered list counts from its own start.
            let num = self.next_num;
            self.next_num += 1;
            self.nums.push((num, true));
            self.lists.push(Some(num));
            return;
        }
        // All bullets share one numbering instance.
        if !self.nums.iter().any(|(_, ordered)| !ordered) {
            self.nums.push((self.next_num, false));
            self.next_num += 1;
        }
        self.lists.push(None);
    }

    fn start_item(&mut self) {
        self.flush();
        let level = (self.lists.len() - 1).min(MAX_LEVELS - 1);
        let num = match self.lists.last().copied().flatten() {
            Some(num) => num,
            None => self.nums.iter().find(|(_, ordered)| !ordered).map_or(0, |(num, _)| *num),
        };
        self.item_marker = Some((num, level));
    }

    fn start_table(&mut self, columns: usize) {
        self.flush();
        let body = std::mem::take(&mut self.out);
        self.table = Some(Table { body, columns, ..Table::default() });
    }

    fn end_table(&mut self) {
        let Some(table) = self.table.take() else { return };
        self.out = table.body;
        let cell = self.text_width_emu / EMU_PER_TWIP / table.columns.max(1) as u64;
        let grid = format!(r#"<w:gridCol w:w="{cell}"/>"#).repeat(table.columns);
        const BORDERS: &str = r#"<w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:color="auto"/></w:tblBorders>"#;
        // Full width, with Word fitting each column to its content. The look is
        // what lets a table style format the first row.
        const FULL_WIDTH: &str = r#"<w:tblW w:w="5000" w:type="pct"/>"#;
        const LOOK: &str = r#"<w:tblLook w:val="0020" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/>"#;
        // Schema order: style, width, borders, look.
        let properties = match self.styles.get("table grid") {
            Some(id) => format!(r#"<w:tblStyle w:val="{id}"/>{FULL_WIDTH}{LOOK}"#),
            None => format!("{FULL_WIDTH}{BORDERS}{LOOK}"),
        };
        self.out.push_str(&format!("<w:tbl><w:tblPr>{properties}</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{}</w:tbl>", table.rows));
        // Word needs a paragraph after a table that ends the body or a cell.
        self.open(String::new());
        self.flush();
    }

    fn end_cell(&mut self) {
        if self.para.is_none() {
            let body = self.body_style();
            self.open(body);
        }
        self.flush();
        let cell = std::mem::take(&mut self.out);
        let Some(table) = &mut self.table else { return };
        table.row.push_str(&format!(r#"<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>{cell}</w:tc>"#));
    }

    fn end_row(&mut self) {
        let Some(table) = &mut self.table else { return };
        let header = if table.head { "<w:trPr><w:tblHeader/></w:trPr>" } else { "" };
        let row = std::mem::take(&mut table.row);
        table.rows.push_str(&format!("<w:tr>{header}{row}</w:tr>"));
    }

    fn footnote_id(&mut self, label: &str) -> i64 {
        // Notes may reuse a label: each note has its own footnotes.
        let key = format!("{}:{label}", self.note_index);
        if let Some(id) = self.footnote_ids.get(&key) {
            return *id;
        }
        let id = self.next_footnote;
        self.next_footnote += 1;
        self.footnote_ids.insert(key, id);
        id
    }

    fn event(&mut self, event: Event, saved: &mut Vec<String>) {
        match event {
            Event::Start(tag) => self.start(tag, saved),
            Event::End(tag) => self.end(tag, saved),
            Event::Text(text) if self.code.is_some() => {
                if let Some((_, code)) = &mut self.code {
                    code.push_str(&text);
                }
            }
            Event::Text(_) if self.in_image => {}
            Event::Text(text) => self.push_text(&text, false),
            Event::Code(text) => self.push_text(&text, true),
            Event::SoftBreak => self.push_text(" ", false),
            Event::HardBreak => self.push_raw("<w:r><w:br/></w:r>"),
            Event::Rule => {
                self.open(r#"<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>"#.to_string());
                self.flush();
            }
            Event::TaskListMarker(done) => self.push_text(if done { "☑ " } else { "☐ " }, false),
            Event::FootnoteReference(label) => {
                let id = self.footnote_id(&label);
                let style = self.styles.superscript();
                self.push_raw(&format!(r#"<w:r><w:rPr>{style}</w:rPr><w:footnoteReference w:id="{id}"/></w:r>"#));
            }
            _ => {}
        }
    }

    fn start(&mut self, tag: Tag, saved: &mut Vec<String>) {
        match tag {
            Tag::Paragraph => {
                let properties = self.body_properties();
                self.open(properties);
            }
            Tag::Heading { level, .. } => {
                let level = (heading_number(level) + self.shift).min(MAX_LEVELS);
                let style = self.heading_style(level);
                // Without the style, the outline level keeps it in the contents.
                let properties = style.as_ref().map_or(format!(r#"<w:outlineLvl w:val="{}"/>"#, level - 1), |id| format!(r#"<w:pStyle w:val="{id}"/>"#));
                self.open(properties);
                self.format.bold = style.is_none();
                self.heading = Some(Heading { level, text: String::new() });
            }
            Tag::BlockQuote(_) => {
                self.flush();
                self.quote += 1;
            }
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or("").to_lowercase(),
                    CodeBlockKind::Indented => String::new(),
                };
                self.code = Some((language, String::new()));
            }
            Tag::List(first) => self.start_list(first),
            Tag::Item => self.start_item(),
            Tag::Table(aligns) => self.start_table(aligns.len()),
            Tag::TableHead => {
                if let Some(t) = &mut self.table {
                    t.head = true;
                }
                self.format.bold = !self.styled_header;
            }
            Tag::TableCell => {
                let body = self.body_style();
                self.open(if body.is_empty() { body } else { format!("{body}{CELL_SPACING}") });
            }
            Tag::Emphasis => self.format.italic = true,
            Tag::Strong => self.format.bold = true,
            Tag::Strikethrough => self.format.strike = true,
            Tag::Link { dest_url, .. } => {
                let url = dest_url.to_string();
                if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:") {
                    self.link = Some(self.add_rel("hyperlink", &url, true));
                }
            }
            Tag::Image { dest_url, title, .. } => {
                let path = dest_url.replace("%20", " ");
                let placed = (self.input.image)(&self.note, &path).is_some_and(|b| self.push_picture(b, &title, 1));
                if !placed {
                    self.push_text(&format!("[Imagen: {path}]"), false);
                }
                self.in_image = true;
            }
            Tag::FootnoteDefinition(label) => {
                self.flush();
                let id = self.footnote_id(&label);
                saved.push(std::mem::take(&mut self.out));
                self.out = format!(r#"<w:footnote w:id="{id}">"#);
                self.footnote_start = true;
            }
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd, saved: &mut Vec<String>) {
        match tag {
            TagEnd::Paragraph | TagEnd::Item => self.flush(),
            TagEnd::Heading(_) => {
                self.flush();
                self.format.bold = false;
                if let Some(h) = self.heading.take() {
                    self.headings.push(h);
                }
            }
            TagEnd::BlockQuote(_) => {
                self.flush();
                self.quote -= 1;
            }
            TagEnd::CodeBlock => {
                if let Some((language, code)) = self.code.take() {
                    self.push_code_block(&language, &code);
                }
            }
            TagEnd::List(_) => {
                self.flush();
                self.lists.pop();
            }
            TagEnd::Table => self.end_table(),
            TagEnd::TableHead => {
                self.format.bold = false;
                self.end_row();
                if let Some(t) = &mut self.table {
                    t.head = false;
                }
            }
            TagEnd::TableRow => self.end_row(),
            TagEnd::TableCell => self.end_cell(),
            TagEnd::Emphasis => self.format.italic = false,
            TagEnd::Strong => self.format.bold = false,
            TagEnd::Strikethrough => self.format.strike = false,
            TagEnd::Link => self.link = None,
            TagEnd::Image => self.in_image = false,
            TagEnd::FootnoteDefinition => {
                self.flush();
                self.out.push_str("</w:footnote>");
                self.footnotes.push_str(&self.out);
                self.out = saved.pop().unwrap_or_default();
            }
            _ => {}
        }
    }
}

fn heading_number(level: HeadingLevel) -> usize {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn text_width_emu(document: &str) -> u64 {
    let last = |re: &Regex| re.captures_iter(document).last().and_then(|c| c[1].parse::<u64>().ok());
    let width = match (last(&PAGE_SIZE), last(&PAGE_MARGIN_L), last(&PAGE_MARGIN_R)) {
        (Some(page), Some(left), Some(right)) if page > left + right => page - left - right,
        _ => DEFAULT_TEXT_WIDTH,
    };
    width * EMU_PER_TWIP
}

fn max_of(re: &Regex, xml: &str) -> i64 {
    re.captures_iter(xml).filter_map(|c| c[1].parse().ok()).max().unwrap_or(0)
}

/// Replaces `{{key}}` in every paragraph. Word often splits a placeholder over
/// several runs, so the text is taken from the whole paragraph; the replacement
/// keeps the formatting of the first run.
fn fill_placeholders(xml: &str, values: &HashMap<String, String>) -> String {
    PARAGRAPH
        .replace_all(xml, |c: &Captures| {
            let paragraph = &c[0];
            let joined: String = TEXT.captures_iter(paragraph).map(|t| t[1].to_string()).collect();
            if !joined.contains("{{") {
                return paragraph.to_string();
            }
            let filled = PLACEHOLDER.replace_all(&joined, |p: &Captures| {
                let key = p[1].to_lowercase();
                match key.as_str() {
                    "contenido" | "content" => p[0].to_string(),
                    _ => values.get(&key).map(|v| escape(v)).unwrap_or_default(),
                }
            });
            if filled == joined {
                return paragraph.to_string();
            }
            let mut first = true;
            TEXT.replace_all(paragraph, |_: &Captures| {
                let text = if first { filled.as_ref() } else { "" };
                first = false;
                format!(r#"<w:t xml:space="preserve">{text}</w:t>"#)
            })
            .into_owned()
        })
        .into_owned()
}

/// Whether a paragraph starts a new page, directly or through its style.
fn breaks_page(paragraph: &str, styles_xml: &str) -> bool {
    if paragraph.contains("<w:pageBreakBefore") || paragraph.contains(r#"w:type="page""#) {
        return true;
    }
    PARAGRAPH_STYLE.captures(paragraph).is_some_and(|style| {
        STYLE
            .find_iter(styles_xml)
            .any(|s| s.as_str().contains(&format!(r#"w:styleId="{}""#, &style[1])) && s.as_str().contains("<w:pageBreakBefore"))
    })
}

/// Starts the body on a new page through its first paragraph, which avoids both
/// an empty line above it and, if it already breaks, a blank page. None if the
/// body does not start with a paragraph.
fn with_page_break(body: &str) -> Option<String> {
    const BREAK: &str = "<w:pageBreakBefore/>";
    let rest = body.strip_prefix("<w:p>")?;
    let first = &rest[..rest.find("</w:p>")?];
    if first.contains(BREAK) {
        return Some(body.to_string());
    }
    let Some(properties) = rest.strip_prefix("<w:pPr>") else {
        return Some(format!("<w:p><w:pPr>{BREAK}</w:pPr>{rest}"));
    };
    let style_end = if properties.starts_with("<w:pStyle") { properties.find("/>")? + 2 } else { 0 };
    Some(format!("<w:p><w:pPr>{}{BREAK}{}", &properties[..style_end], &properties[style_end..]))
}

/// The marker's paragraph without its text, keeping what it does to the layout.
fn emptied(paragraph: &str) -> String {
    TEXT.replace_all(paragraph, "<w:t></w:t>").into_owned()
}

/// Puts the body where the template says or, without a marker, at the end. A
/// marker's paragraph can carry a section or page break, which must survive:
/// a section break ends what comes before it, a page break starts what follows.
fn insert_body(document: &str, body: &str, styles_xml: &str) -> String {
    let marker = PARAGRAPH.find_iter(document).find(|m| {
        let text: String = TEXT.captures_iter(m.as_str()).map(|t| t[1].to_string()).collect();
        let text = text.replace(' ', "").to_lowercase();
        text == "{{contenido}}" || text == "{{content}}"
    });
    if let Some(m) = marker {
        let (head, paragraph, tail) = (&document[..m.start()], m.as_str(), &document[m.end()..]);
        if paragraph.contains("<w:sectPr") {
            return format!("{head}{body}{}{tail}", emptied(paragraph));
        }
        if breaks_page(paragraph, styles_xml) {
            return match with_page_break(body) {
                Some(body) => format!("{head}{body}{tail}"),
                None => format!("{head}{}{body}{tail}", emptied(paragraph)),
            };
        }
        return format!("{head}{body}{tail}");
    }
    let end = document.rfind("<w:sectPr").or_else(|| document.rfind("</w:body>")).unwrap_or(document.len());
    format!("{}{body}{}", &document[..end], &document[end..])
}

/// The heading levels a TOC field lists: the range of `\o`, plus those that `\t`
/// names as pairs of style and level, as in `\t "Título 1;1;Mi-titulo;2"`.
fn toc_levels(instruction: &str) -> Vec<usize> {
    let mut levels: Vec<usize> = TOC_LEVELS.captures(instruction).map_or(Vec::new(), |c| {
        (c[1].parse().unwrap_or(1)..=c[2].parse().unwrap_or(3)).collect()
    });
    if let Some(styles) = TOC_STYLES.captures(instruction) {
        let pairs: Vec<&str> = styles[1].split([';', ',']).collect();
        levels.extend(pairs.chunks_exact(2).filter_map(|pair| pair[1].trim().parse::<usize>().ok()));
    }
    if levels.is_empty() { (1..=3).collect() } else { levels }
}

/// Whether a table style has its own format for the first row.
fn formats_first_row(styles_xml: &str, id: &str) -> bool {
    let start = format!(r#"w:styleId="{id}""#);
    styles_xml.find(&start).is_some_and(|at| {
        let style = &styles_xml[at..];
        let end = style.find("</w:style>").unwrap_or(style.len());
        style[..end].contains(r#"w:type="firstRow""#)
    })
}

/// Refills the entries of a TOC field with the note's headings, so the contents
/// are right even before Word recalculates the page numbers. The field itself
/// stays real. Returns None when the template has no contents.
fn rebuild_toc(document: &str, headings: &[Heading], styles: &Styles) -> Option<String> {
    let instr = TOC_INSTR.captures(document)?;
    let position = instr.get(0)?.end();
    let levels = toc_levels(&instr[1]);

    let separate = position + document[position..].find(r#"w:fldCharType="separate""#)?;
    let result_start = separate + document[separate..].find("</w:r>")? + "</w:r>".len();

    // Entries contain nested fields such as PAGEREF: find the matching end.
    let mut depth = 1;
    let mut cursor = result_start;
    let end = loop {
        let rest = &document[cursor..];
        let begin = rest.find(r#"w:fldCharType="begin""#);
        let finish = rest.find(r#"w:fldCharType="end""#)?;
        match begin {
            Some(b) if b < finish => {
                depth += 1;
                cursor += b + 1;
            }
            _ => {
                depth -= 1;
                cursor += finish + 1;
                if depth == 0 {
                    break cursor - 1;
                }
            }
        }
    };
    let result_end = document[..end].rfind("<w:r>").max(document[..end].rfind("<w:r "))?;

    let entries: Vec<&Heading> = headings.iter().filter(|h| levels.contains(&h.level)).collect();
    let mut generated = String::new();
    for (i, heading) in entries.iter().enumerate() {
        if i > 0 {
            let style = styles.paragraph(&format!("toc {}", heading.level));
            generated.push_str(&format!("</w:p><w:p><w:pPr>{style}</w:pPr>"));
        }
        generated.push_str(&format!(r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#, escape(&heading.text)));
    }
    Some(format!("{}{generated}{}", &document[..result_start], &document[result_end..]))
}

/// Word warns about external files whenever a document asks to refresh its fields
/// on opening, so that request never goes out, even if a template carries it.
fn without_field_update(settings: &str) -> String {
    UPDATE_FIELDS.replace_all(settings, "").into_owned()
}

fn add_override(types: &mut String, part: &str, content_type: &str) {
    if !types.contains(&format!(r#"PartName="/{part}""#)) {
        let entry = format!(r#"<Override PartName="/{part}" ContentType="{content_type}"/>"#);
        *types = types.replace("</Types>", &format!("{entry}</Types>"));
    }
}

fn add_image_type(types: &mut String, ext: &str) {
    if !types.to_lowercase().contains(&format!(r#"extension="{ext}""#)) {
        let entry = format!(r#"<Default Extension="{ext}" ContentType="image/{ext}"/>"#);
        *types = types.replacen("<Override", &format!("{entry}<Override"), 1);
    }
}

fn level_definitions(ordered: bool) -> String {
    (0..MAX_LEVELS)
        .map(|level| {
            let indent = 360 * (level + 2);
            let (kind, text) = if ordered {
                ("decimal", format!("%{}.", level + 1))
            } else {
                ("bullet", ["•", "◦", "▪"][level % 3].to_string())
            };
            format!(
                r#"<w:lvl w:ilvl="{level}"><w:start w:val="1"/><w:numFmt w:val="{kind}"/><w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="{indent}" w:hanging="360"/></w:pPr></w:lvl>"#
            )
        })
        .collect()
}

fn add_numbering(parts: &mut Package, writer: &Writer, types: &mut String, rels: &mut String) {
    if writer.nums.is_empty() {
        return;
    }
    let mut xml = text_of(parts, NUMBERING).unwrap_or_else(|| {
        *rels = rels.replace("</Relationships>", &format!(r#"<Relationship Id="rIdUmdNum" Type="{REL_NS}/numbering" Target="numbering.xml"/></Relationships>"#));
        add_override(types, NUMBERING, "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml");
        format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="{W_NS}"></w:numbering>"#)
    });
    let (bullets, ordered) = (writer.next_abstract, writer.next_abstract + 1);
    let abstracts = format!(
        r#"<w:abstractNum w:abstractNumId="{bullets}"><w:multiLevelType w:val="hybridMultilevel"/>{}</w:abstractNum><w:abstractNum w:abstractNumId="{ordered}"><w:multiLevelType w:val="hybridMultilevel"/>{}</w:abstractNum>"#,
        level_definitions(false),
        level_definitions(true),
    );
    let nums: String = writer
        .nums
        .iter()
        .map(|(num, is_ordered)| {
            let source = if *is_ordered { ordered } else { bullets };
            let restart = if *is_ordered { r#"<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>"# } else { "" };
            format!(r#"<w:num w:numId="{num}"><w:abstractNumId w:val="{source}"/>{restart}</w:num>"#)
        })
        .collect();
    // Abstract definitions must come before every instance.
    let first_num = xml.find("<w:num ").or_else(|| xml.find("<w:numIdMacAtCleanup")).or_else(|| xml.rfind("</w:numbering>")).unwrap_or(0);
    xml.insert_str(first_num, &abstracts);
    let end = xml.find("<w:numIdMacAtCleanup").or_else(|| xml.rfind("</w:numbering>")).unwrap_or(xml.len());
    xml.insert_str(end, &nums);
    parts.insert(NUMBERING.to_string(), xml.into_bytes());
}

fn add_footnotes(parts: &mut Package, writer: &Writer, types: &mut String, rels: &mut String) {
    if writer.footnotes.is_empty() {
        return;
    }
    let xml = text_of(parts, FOOTNOTES).unwrap_or_else(|| {
        *rels = rels.replace("</Relationships>", &format!(r#"<Relationship Id="rIdUmdFn" Type="{REL_NS}/footnotes" Target="footnotes.xml"/></Relationships>"#));
        add_override(types, FOOTNOTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml");
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="{W_NS}" xmlns:r="{REL_NS}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote></w:footnotes>"#
        )
    });
    let xml = xml.replace("</w:footnotes>", &format!("{}</w:footnotes>", writer.footnotes));
    parts.insert(FOOTNOTES.to_string(), xml.into_bytes());
}

const BLANK_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>"#;

fn blank_styles() -> String {
    let heading = |n: usize, size: usize| {
        format!(
            r#"<w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="{lvl}"/></w:pPr><w:rPr><w:b/><w:sz w:val="{size}"/></w:rPr></w:style>"#,
            lvl = n - 1
        )
    };
    let headings: String = [(1, 40), (2, 32), (3, 28), (4, 24), (5, 22), (6, 22)].iter().map(|(n, s)| heading(*n, *s)).collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>{headings}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>"#
    )
}

fn blank_package() -> Package {
    let parts = [
        (CONTENT_TYPES, BLANK_TYPES.to_string()),
        ("_rels/.rels", format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_NS}/officeDocument" Target="word/document.xml"/></Relationships>"#)),
        (DOC_RELS, format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_NS}/styles" Target="styles.xml"/></Relationships>"#)),
        (STYLES, blank_styles()),
        (DOCUMENT, format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W_NS}" xmlns:r="{REL_NS}"><w:body><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>"#)),
    ];
    parts.into_iter().map(|(k, v)| (k.to_string(), v.into_bytes())).collect()
}

/// Generates the `.docx`.
pub fn render(input: &Input) -> Result<Vec<u8>> {
    let mut parts = match input.template {
        Some(bytes) => read_package(bytes)?,
        None => blank_package(),
    };
    let document = text_of(&parts, DOCUMENT).ok_or_else(|| invalid("no document part"))?;
    let styles_xml = text_of(&parts, STYLES).unwrap_or_default();
    let styles = Styles::parse(&styles_xml);
    let numbering = text_of(&parts, NUMBERING).unwrap_or_default();
    let notes = text_of(&parts, FOOTNOTES).unwrap_or_default();

    let options = Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS;

    let mut writer = Writer {
        styles: &styles,
        input,
        text_width_emu: text_width_emu(&document),
        out: String::new(),
        para: None,
        format: Format::default(),
        link: None,
        rels: Vec::new(),
        media: Vec::new(),
        headings: Vec::new(),
        heading: None,
        next_diagram: 0,
        drawing_id: 9000,
        code: None,
        in_image: false,
        lists: Vec::new(),
        next_num: max_of(&NUM_ID, &numbering) + 1,
        nums: Vec::new(),
        item_marker: None,
        next_abstract: max_of(&ABSTRACT_ID, &numbering) + 1,
        quote: 0,
        footnote_ids: HashMap::new(),
        next_footnote: max_of(&FOOTNOTE_ID, &notes).max(0) + 1,
        footnotes: String::new(),
        footnote_start: false,
        page_break: false,
        note: String::new(),
        note_index: 0,
        shift: 0,
        table: None,
        styled_header: styles.get("table grid").is_some_and(|id| formats_first_row(&styles_xml, id)),
        detected: detect::detect(&styles_xml, &text_of(&parts, NUMBERING).unwrap_or_default(), &text_of(&parts, DOCUMENT).unwrap_or_default()),
    };
    let mut saved = Vec::new();
    let mut values: HashMap<String, String> = HashMap::new();
    for (index, section) in input.sections.iter().enumerate() {
        match section {
            Section::Heading { text, style, level, page_break } => writer.section_heading(text, style.as_deref(), *level, *page_break),
            Section::Note { path, markdown, shift, page_break } => {
                let (meta, body) = split_frontmatter(markdown);
                // The first note to state a value provides it.
                for (key, value) in meta {
                    values.entry(key).or_insert(value);
                }
                writer.flush();
                writer.note = path.clone();
                writer.note_index = index;
                writer.shift = *shift;
                writer.page_break = *page_break;
                for event in Parser::new_ext(&normalize_wikilinks(body), options) {
                    writer.event(event, &mut saved);
                }
                writer.flush();
            }
        }
    }

    let first_heading = writer.headings.first().map(|h| h.text.clone());
    let stated = values.get("titulo").or(values.get("title")).cloned().or(first_heading);
    let title = if input.fixed_title { input.title.to_string() } else { stated.unwrap_or_else(|| input.title.to_string()) };
    let author = values.get("autor").or(values.get("author")).cloned().unwrap_or_default();
    let date = values.get("fecha").or(values.get("date")).cloned().unwrap_or_else(|| input.date.to_string());
    let contents = input.contents.to_string();
    for (key, value) in [("titulo", &title), ("title", &title), ("autor", &author), ("author", &author), ("fecha", &date), ("date", &date), ("indice", &contents)] {
        values.insert(key.to_string(), value.clone());
    }

    let mut document = insert_body(&fill_placeholders(&document, &values), &writer.out, &styles_xml);
    let toc = rebuild_toc(&document, &writer.headings, &styles);
    if let Some(rebuilt) = toc {
        document = rebuilt;
    }
    parts.insert(DOCUMENT.to_string(), document.into_bytes());

    let furniture: Vec<String> = parts.keys().filter(|n| n.starts_with("word/header") || n.starts_with("word/footer")).cloned().collect();
    for name in furniture {
        if let Some(xml) = text_of(&parts, &name) {
            parts.insert(name, fill_placeholders(&xml, &values).into_bytes());
        }
    }

    let mut types = text_of(&parts, CONTENT_TYPES).unwrap_or_default();
    let mut rels = text_of(&parts, DOC_RELS).unwrap_or_else(|| {
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_string()
    });
    add_numbering(&mut parts, &writer, &mut types, &mut rels);
    add_footnotes(&mut parts, &writer, &mut types, &mut rels);
    rels = rels.replace("</Relationships>", &format!("{}</Relationships>", writer.rels.concat()));
    for (name, bytes) in std::mem::take(&mut writer.media) {
        if let Some(ext) = name.rsplit('.').next() {
            add_image_type(&mut types, ext);
        }
        parts.insert(name, bytes);
    }
    if let Some(settings) = text_of(&parts, SETTINGS) {
        parts.insert(SETTINGS.to_string(), without_field_update(&settings).into_bytes());
    }
    parts.insert(CONTENT_TYPES.to_string(), types.into_bytes());
    parts.insert(DOC_RELS.to_string(), rels.into_bytes());
    write_package(&parts)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StyleInfo {
    pub id: String,
    pub name: String,
}

/// The paragraph styles a document offers.
pub fn paragraph_styles(template: Option<&[u8]>) -> Result<Vec<StyleInfo>> {
    let parts = template.map_or_else(|| Ok(blank_package()), read_package)?;
    let xml = text_of(&parts, STYLES).unwrap_or_default();
    let mut styles: Vec<StyleInfo> = STYLE
        .find_iter(&xml)
        .map(|m| m.as_str())
        .filter(|s| s.contains(r#"w:type="paragraph""#))
        .filter_map(|s| Some(StyleInfo { id: STYLE_ID.captures(s)?[1].to_string(), name: STYLE_NAME.captures(s)?[1].to_string() }))
        .collect();
    styles.sort_by_key(|s| s.name.to_lowercase());
    Ok(styles)
}

/// A complete template to try exports with: cover, contents, header, numbered
/// footer and its own styles.
pub fn example_template() -> Vec<u8> {
    const INK: &str = "1F3A5F";
    let style = |id: &str, name: &str, ppr: &str, rpr: &str| {
        format!(r#"<w:style w:type="paragraph" w:styleId="{id}"><w:name w:val="{name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>{ppr}</w:pPr><w:rPr>{rpr}</w:rPr></w:style>"#)
    };
    let heading = |n: usize, size: usize, before: usize| {
        style(&format!("Heading{n}"), &format!("heading {n}"), &format!(r#"<w:keepNext/><w:spacing w:before="{before}" w:after="100"/><w:outlineLvl w:val="{}"/>"#, n - 1), &format!(r#"<w:b/><w:color w:val="{INK}"/><w:sz w:val="{size}"/>"#))
    };
    let toc = |n: usize| style(&format!("TOC{n}"), &format!("toc {n}"), &format!(r#"<w:spacing w:after="60"/><w:ind w:left="{}"/>"#, (n - 1) * 240), "");
    let styles: String = [
        style("Title", "Title", r#"<w:spacing w:before="3600" w:after="240"/><w:jc w:val="center"/>"#, &format!(r#"<w:b/><w:color w:val="{INK}"/><w:sz w:val="64"/>"#)),
        style("Subtitle", "Subtitle", r#"<w:jc w:val="center"/>"#, r#"<w:color w:val="595959"/><w:sz w:val="26"/>"#),
        heading(1, 34, 360), heading(2, 28, 280), heading(3, 24, 200), heading(4, 22, 160), heading(5, 22, 120), heading(6, 22, 120),
        toc(1), toc(2), toc(3),
        style("TOCHeading", "TOC Heading", r#"<w:pageBreakBefore/><w:spacing w:after="240"/>"#, &format!(r#"<w:b/><w:color w:val="{INK}"/><w:sz w:val="34"/>"#)),
        style("ListParagraph", "List Paragraph", "", ""),
        style("Quote", "Quote", r#"<w:ind w:left="567"/>"#, r#"<w:i/><w:color w:val="595959"/>"#),
        style("Header", "header", r#"<w:jc w:val="right"/>"#, r#"<w:color w:val="7F7F7F"/><w:sz w:val="18"/>"#),
        style("Footer", "footer", r#"<w:jc w:val="center"/>"#, r#"<w:color w:val="7F7F7F"/><w:sz w:val="18"/>"#),
        style("FootnoteText", "footnote text", "", r#"<w:sz w:val="18"/>"#),
    ]
    .concat();
    let table = r#"<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders></w:tblPr></w:style>"#;
    let link = r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1A4F8A"/><w:u w:val="single"/></w:rPr></w:style>"#;
    let styles_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="{W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>{styles}{table}{link}</w:styles>"#
    );
    let para = |style: &str, text: &str| format!(r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#);
    let toc_field = r#"<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \o "1-3" \h \z \u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Índice</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#;
    let body = [
        para("Title", "{{titulo}}"),
        para("Subtitle", "{{autor}}"),
        para("Subtitle", "{{fecha}}"),
        para("TOCHeading", "{{indice}}"),
        toc_field.to_string(),
        r#"<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>{{contenido}}</w:t></w:r></w:p>"#.to_string(),
        r#"<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/><w:titlePg/></w:sectPr>"#.to_string(),
    ]
    .concat();
    let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;
    let page_field = r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>"#;
    let main_type = "application/vnd.openxmlformats-officedocument.wordprocessingml";
    let mut types = BLANK_TYPES.to_string();
    add_override(&mut types, "word/settings.xml", &format!("{main_type}.settings+xml"));
    add_override(&mut types, "word/header1.xml", &format!("{main_type}.header+xml"));
    add_override(&mut types, "word/footer1.xml", &format!("{main_type}.footer+xml"));
    let parts: Package = [
        (CONTENT_TYPES.to_string(), types),
        ("_rels/.rels".to_string(), format!(r#"{xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_NS}/officeDocument" Target="word/document.xml"/></Relationships>"#)),
        (DOC_RELS.to_string(), format!(r#"{xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL_NS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="{REL_NS}/settings" Target="settings.xml"/><Relationship Id="rIdHeader" Type="{REL_NS}/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="{REL_NS}/footer" Target="footer1.xml"/></Relationships>"#)),
        (STYLES.to_string(), styles_xml),
        (SETTINGS.to_string(), format!(r#"{xml}<w:settings xmlns:w="{W_NS}"><w:compat/></w:settings>"#)),
        ("word/header1.xml".to_string(), format!(r#"{xml}<w:hdr xmlns:w="{W_NS}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr><w:r><w:t>{{{{titulo}}}}</w:t></w:r></w:p></w:hdr>"#)),
        ("word/footer1.xml".to_string(), format!(r#"{xml}<w:ftr xmlns:w="{W_NS}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>{page_field}</w:p></w:ftr>"#)),
        (DOCUMENT.to_string(), format!(r#"{xml}<w:document xmlns:w="{W_NS}" xmlns:r="{REL_NS}"><w:body>{body}</w:body></w:document>"#)),
    ]
    .into_iter()
    .map(|(k, v)| (k, v.into_bytes()))
    .collect();
    write_package(&parts).expect("a package held in memory can always be written")
}

#[cfg(test)]
mod tests;
