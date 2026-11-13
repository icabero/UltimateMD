//! Turns notes into Typst source. All text is emitted as string literals.

use crate::Input;
use pulldown_cmark::{BlockQuoteKind, CodeBlockKind, Event, HeadingLevel, Tag, TagEnd};
use std::collections::HashMap;
use ultimatemd_core::docx::{Section, split_frontmatter};
use ultimatemd_core::export_links;

/// Width of the text area on A4 with these margins, in points.
const TEXT_WIDTH: f64 = 453.0;
/// Diagrams are rasterised at twice their size.
const DIAGRAM_SCALE: f64 = 2.0;
/// CSS pixels to points.
const PT_PER_PX: f64 = 0.75;
/// Marks a footnote reference until the note's definitions are known.
const NOTE_OPEN: char = '\u{E000}';
const NOTE_CLOSE: char = '\u{E001}';

const PREAMBLE: &str = r##"
#set page(paper: "a4", fill: white, margin: (x: 2.5cm, top: 2.6cm, bottom: 2.4cm),
  footer: context align(center, text(8.5pt, fill: luma(110), counter(page).display("1"))))
#set text(font: "Libertinus Serif", size: 11pt, lang: "es", fill: black)
#set par(justify: true, leading: 0.68em, spacing: 1.05em)
#set list(indent: 0.6em, spacing: 0.6em)
#set enum(indent: 0.6em, spacing: 0.6em)
#set table(stroke: 0.5pt + luma(170), inset: 6pt)
#show table.cell.where(y: 0): set text(weight: "bold")
#show heading: it => block(above: 1.5em, below: 0.75em, it)
#show heading: set text(weight: "bold")
#show heading.where(level: 1): set text(20pt)
#show heading.where(level: 2): set text(15pt)
#show heading.where(level: 3): set text(12.5pt)
#show heading.where(level: 4): set text(11pt)
#show raw.where(block: true): it => block(fill: luma(246), inset: 10pt, radius: 3pt, width: 100%, breakable: true, text(8.8pt, it))
#show raw.where(block: false): set text(0.92em)
#show quote.where(block: true): it => block(inset: (left: 12pt, y: 2pt), stroke: (left: 1.5pt + luma(170)), text(fill: luma(70), it.body))
#show link: set text(fill: rgb("#1a4f8a"))
"##;

/// A string literal holding `text`.
fn quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Text inside content brackets.
fn text(value: &str) -> String {
    format!("#{}", quoted(value))
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

enum Open {
    /// Collects inline or block content, then wraps it.
    Wrap(Box<dyn Fn(&str) -> String>),
    List {
        first: Option<u64>,
        items: Vec<String>,
    },
    Table {
        columns: usize,
        cells: Vec<String>,
    },
    Footnote(String),
}

struct Writer<'a> {
    input: &'a Input<'a>,
    note: String,
    /// The section being written and how many of its headings came before.
    section: usize,
    note_heading: usize,
    shift: usize,
    out: Vec<String>,
    open: Vec<Open>,
    code: Option<(String, String)>,
    in_image: bool,
    next_diagram: usize,
    images: Vec<(String, Vec<u8>)>,
    notes: HashMap<String, String>,
    /// Draw formulas as Typst math. Off, they are written as typed: the way out
    /// when Typst cannot lay out a formula, so that the export still happens.
    formulas: bool,
}

impl Writer<'_> {
    fn math(&mut self, latex: &str, display: bool) {
        let marks = if display { "$$" } else { "$" };
        let typst = if self.formulas { ultimatemd_core::math::to_typst(latex, display) } else { None };
        match typst {
            Some(math) if display => {
                self.push(&format!("#block(width: 100%, breakable: false)[#align(center)[{math}]]\n\n"))
            }
            Some(math) => self.push(&math),
            None => self.push(&format!("#raw({})", quoted(&format!("{marks}{latex}{marks}")))),
        }
    }

    fn push(&mut self, value: &str) {
        if let Some(buffer) = self.out.last_mut() {
            buffer.push_str(value);
        }
    }

    fn enter(&mut self, open: Open) {
        self.open.push(open);
        self.out.push(String::new());
    }

    fn wrap(&mut self, wrap: impl Fn(&str) -> String + 'static) {
        self.enter(Open::Wrap(Box::new(wrap)));
    }

    fn leave(&mut self) {
        let content = self.out.pop().unwrap_or_default();
        match self.open.pop() {
            Some(Open::Wrap(wrap)) => self.push(&wrap(&content)),
            Some(Open::Footnote(label)) => {
                self.notes.insert(label, content);
            }
            _ => {}
        }
    }

    fn add_image(&mut self, bytes: Vec<u8>, scale: f64) -> Option<String> {
        let name = |ext: &str, n: usize| format!("/img{n}.{ext}");
        let n = self.images.len();
        if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") {
            let path = name("svg", n);
            self.images.push((path.clone(), bytes));
            return Some(format!("#image({}, width: 100%)\n\n", quoted(&path)));
        }
        // A damaged file must cost one image, not the whole export.
        image::load_from_memory(&bytes).ok()?;
        let ext = match imagesize::image_type(&bytes).ok()? {
            imagesize::ImageType::Png => "png",
            imagesize::ImageType::Jpeg => "jpg",
            imagesize::ImageType::Gif => "gif",
            imagesize::ImageType::Webp => "webp",
            _ => return None,
        };
        let width = imagesize::blob_size(&bytes).ok()?.width as f64 * PT_PER_PX / scale;
        let path = name(ext, n);
        self.images.push((path.clone(), bytes));
        Some(format!("#image({}, width: {:.1}pt)", quoted(&path), width.min(TEXT_WIDTH)))
    }

    fn code_block(&mut self, language: &str, code: &str) {
        if language == "mermaid" || language == "d2" {
            let png = self.input.diagrams.get(self.next_diagram).cloned().unwrap_or_default();
            self.next_diagram += 1;
            match self.add_image(png, DIAGRAM_SCALE) {
                Some(image) => self.push(&format!("#align(center, {})\n\n", &image[1..])),
                None => self.push(&format!("{}\n\n", text("[Diagrama no disponible]"))),
            }
            return;
        }
        let code = quoted(code.trim_end_matches('\n'));
        let lang = if language.is_empty() { "none".to_string() } else { quoted(language) };
        self.push(&format!("#raw(block: true, lang: {lang}, {code})\n\n"));
    }

    fn event(&mut self, event: Event) {
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(value) if self.code.is_some() => {
                if let Some((_, code)) = &mut self.code {
                    code.push_str(&value);
                }
            }
            Event::Text(_) if self.in_image => {}
            Event::Text(value) => self.push(&text(&value)),
            Event::Code(value) => self.push(&format!("#raw({})", quoted(&value))),
            Event::InlineMath(latex) => self.math(&latex, false),
            Event::DisplayMath(latex) => self.math(&latex, true),
            Event::SoftBreak => self.push(&text(" ")),
            Event::HardBreak => self.push("#linebreak()"),
            Event::Rule => self.push("#line(length: 100%, stroke: 0.5pt + luma(170))\n\n"),
            Event::TaskListMarker(done) => self.push(&text(if done { "☑ " } else { "☐ " })),
            Event::FootnoteReference(label) => self.push(&format!("{NOTE_OPEN}{label}{NOTE_CLOSE}")),
            _ => {}
        }
    }

    fn start(&mut self, tag: Tag) {
        match tag {
            Tag::Heading { level, .. } => {
                let level = (heading_number(level) + self.shift).min(6);
                let name = export_links::heading_anchor(self.section, self.note_heading);
                self.note_heading += 1;
                self.wrap(move |c| format!("#heading(level: {level})[{c}]<{name}>\n\n"));
            }
            Tag::BlockQuote(None) => self.wrap(|c| format!("#quote(block: true)[{c}]\n\n")),
            Tag::BlockQuote(Some(kind)) => {
                let (line, fill) = callout_colors(kind);
                self.wrap(move |c| {
                    format!(
                        "#block(width: 100%, inset: (x: 10pt, y: 8pt), radius: 2pt, fill: rgb(\"#{fill}\"), stroke: (left: 3pt + rgb(\"#{line}\")))[{c}]\n\n"
                    )
                })
            }
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or("").to_lowercase(),
                    CodeBlockKind::Indented => String::new(),
                };
                self.code = Some((language, String::new()));
            }
            Tag::List(first) => self.enter(Open::List { first, items: Vec::new() }),
            Tag::Item => self.wrap(|c| format!("[{c}]")),
            Tag::Table(aligns) => self.enter(Open::Table { columns: aligns.len(), cells: Vec::new() }),
            Tag::TableCell => self.wrap(|c| format!("[{c}]")),
            Tag::Emphasis => self.wrap(|c| format!("#emph[{c}]")),
            Tag::Strong => self.wrap(|c| format!("#strong[{c}]")),
            Tag::Strikethrough => self.wrap(|c| format!("#strike[{c}]")),
            Tag::Link { dest_url, .. } => {
                let url = dest_url.to_string();
                if let Some(anchor) = export_links::internal(&url) {
                    let anchor = anchor.to_string();
                    self.wrap(move |c| format!("#link(<{anchor}>)[{c}]"));
                } else if url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:") {
                    let target = quoted(&url);
                    self.wrap(move |c| format!("#link({target})[{c}]"));
                } else {
                    self.wrap(str::to_string);
                }
            }
            Tag::Image { dest_url, .. } => {
                let path = dest_url.replace("%20", " ");
                let bytes = (self.input.image)(&self.note, &path);
                match bytes.and_then(|b| self.add_image(b, 1.0)) {
                    Some(image) => self.push(&image),
                    None => self.push(&text(&format!("[Imagen: {path}]"))),
                }
                self.in_image = true;
            }
            Tag::FootnoteDefinition(label) => self.enter(Open::Footnote(label.to_string())),
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => self.push("\n\n"),
            TagEnd::Heading(_)
            | TagEnd::BlockQuote(_)
            | TagEnd::Emphasis
            | TagEnd::Strong
            | TagEnd::Strikethrough
            | TagEnd::Link
            | TagEnd::FootnoteDefinition => self.leave(),
            TagEnd::CodeBlock => {
                if let Some((language, code)) = self.code.take() {
                    self.code_block(&language, &code);
                }
            }
            TagEnd::Item => {
                let content = self.out.pop().unwrap_or_default();
                self.open.pop();
                if let Some(Open::List { items, .. }) = self.open.last_mut() {
                    items.push(format!("[{content}]"));
                }
            }
            TagEnd::List(_) => {
                self.out.pop();
                if let Some(Open::List { first, items }) = self.open.pop() {
                    let items = items.join(", ");
                    match first {
                        Some(start) => self.push(&format!("#enum(start: {start}, {items})\n\n")),
                        None => self.push(&format!("#list({items})\n\n")),
                    }
                }
            }
            TagEnd::TableCell => {
                let content = self.out.pop().unwrap_or_default();
                self.open.pop();
                if let Some(Open::Table { cells, .. }) = self.open.last_mut() {
                    cells.push(format!("[{content}]"));
                }
            }
            TagEnd::Table => {
                self.out.pop();
                if let Some(Open::Table { columns, cells }) = self.open.pop() {
                    let widths = vec!["1fr"; columns].join(", ");
                    self.push(&format!("#table(columns: ({widths},), {})\n\n", cells.join(", ")));
                }
            }
            TagEnd::Image => self.in_image = false,
            _ => {}
        }
    }
}

/// Puts each footnote's text in place of its reference.
fn resolve_footnotes(content: &str, notes: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(content.len());
    let mut rest = content;
    while let Some(start) = rest.find(NOTE_OPEN) {
        out.push_str(&rest[..start]);
        rest = &rest[start + NOTE_OPEN.len_utf8()..];
        let Some(end) = rest.find(NOTE_CLOSE) else { break };
        let body = notes.get(&rest[..end]).map(|n| n.trim()).unwrap_or_default();
        out.push_str(&format!("#footnote[{body}]"));
        rest = &rest[end + NOTE_CLOSE.len_utf8()..];
    }
    out.push_str(rest);
    out
}

fn cover(title: &str, author: &str, date: &str, contents: &str) -> String {
    let byline = if author.is_empty() {
        String::new()
    } else {
        format!("  #v(0.8em)\n  #align(center)[#text(14pt, {})]\n", quoted(author))
    };
    let (title, date, contents) = (quoted(title), quoted(date), quoted(contents));
    format!(
        r#"#page(footer: none)[
  #v(1fr)
  #align(center)[#text(28pt, weight: "bold", {title})]
{byline}  #v(0.6em)
  #align(center)[#text(12pt, fill: luma(90), {date})]
  #v(1.3fr)
]
#outline(title: {contents}, depth: 3)
#pagebreak()
"#
    )
}

/// The author stated by the first note that states one, as in Word.
pub fn author(sections: &[Section]) -> String {
    sections
        .iter()
        .find_map(|section| match section {
            Section::Note { markdown, .. } => {
                let meta = split_frontmatter(markdown).0;
                meta.get("autor").or(meta.get("author")).filter(|a| !a.is_empty()).cloned()
            }
            Section::Heading { .. } => None,
        })
        .unwrap_or_default()
}

/// Returns the Typst source and the images it refers to.
pub fn build(input: &Input, formulas: bool) -> (String, Vec<(String, Vec<u8>)>) {
    let author = author(input.sections);
    let metadata = if author.is_empty() { String::new() } else { format!(", author: {}", quoted(&author)) };
    let mut source = format!(
        "#set document(title: {}{metadata})\n{PREAMBLE}\n#set text(lang: {})\n",
        quoted(input.title),
        quoted(input.language)
    );
    if input.cover {
        source.push_str(&cover(input.title, &author, input.date, input.contents));
    }
    let bodies = export_links::bodies(input.sections, input.language);
    let mut writer = Writer {
        input,
        note: String::new(),
        section: 0,
        note_heading: 0,
        shift: 0,
        out: vec![String::new()],
        open: Vec::new(),
        code: None,
        in_image: false,
        next_diagram: 0,
        images: Vec::new(),
        notes: HashMap::new(),
        formulas,
    };
    for (index, section) in input.sections.iter().enumerate() {
        match section {
            Section::Heading { text: title, level, page_break, .. } => {
                let level = (*level).clamp(1, 6);
                if *page_break {
                    source.push_str("#pagebreak(weak: true)\n");
                }
                source.push_str(&format!("#heading(level: {level})[{}]\n\n", text(title)));
            }
            Section::Note { path, shift, page_break, .. } => {
                if *page_break {
                    source.push_str("#pagebreak(weak: true)\n");
                }
                writer.note = path.clone();
                writer.shift = *shift;
                writer.notes.clear();
                writer.section = index;
                writer.note_heading = 0;
                // Where links to the note land.
                writer.push(&format!("#metadata(none)<{}>\n", export_links::note_anchor(index)));
                for event in ultimatemd_core::math::events(&bodies[index]) {
                    writer.event(event);
                }
                let content = std::mem::take(&mut writer.out[0]);
                source.push_str(&resolve_footnotes(&content, &writer.notes));
            }
        }
    }
    (source, writer.images)
}

/// The line and fill colours of each kind of callout, the same as in Word.
fn callout_colors(kind: BlockQuoteKind) -> (&'static str, &'static str) {
    match kind {
        BlockQuoteKind::Note => ("2563EB", "EFF6FF"),
        BlockQuoteKind::Tip => ("16A34A", "F0FDF4"),
        BlockQuoteKind::Important => ("7C3AED", "F5F3FF"),
        BlockQuoteKind::Warning => ("D97706", "FFFBEB"),
        BlockQuoteKind::Caution => ("DC2626", "FEF2F2"),
    }
}
