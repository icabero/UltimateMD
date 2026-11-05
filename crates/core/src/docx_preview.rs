//! Reads a generated `.docx` back for on-screen display. Showing the file
//! itself, rather than a parallel rendering, keeps the preview honest. It is an
//! approximation of Word's layout: fonts and page breaks may differ slightly.

use crate::docx::{Package, read_package};
use crate::{Error, Result};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use roxmltree::{Document, Node};
use serde::Serialize;
use std::collections::HashMap;

const MAX_STYLE_DEPTH: usize = 16;
const TWIPS_PER_PT: f32 = 20.0;
const EMU_PER_PT: f32 = 12700.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub html: String,
    pub break_before: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Page size and margins, in points.
    pub width: f32,
    pub height: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
    pub header: String,
    pub footer: String,
    /// True when the first page shows no header or footer.
    pub title_page: bool,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Default)]
struct Props {
    font: Option<String>,
    size: Option<f32>,
    color: Option<String>,
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    align: Option<String>,
    before: Option<f32>,
    after: Option<f32>,
    left: Option<f32>,
    line: Option<f32>,
    shade: Option<String>,
    page_break: Option<bool>,
}

impl Props {
    fn over(mut self, top: &Props) -> Props {
        macro_rules! take {
            ($($field:ident),*) => { $(if top.$field.is_some() { self.$field = top.$field.clone(); })* };
        }
        take!(font, size, color, bold, italic, underline, strike, align, before, after, left, line, shade, page_break);
        self
    }

    fn css(&self, block: bool) -> String {
        let mut css = String::new();
        if let Some(font) = &self.font {
            css.push_str(&format!("font-family:'{}',serif;", font.replace(['\'', '"', ';', '<', '>'], "")));
        }
        if let Some(size) = self.size {
            css.push_str(&format!("font-size:{size}pt;"));
        }
        if let Some(color) = &self.color {
            css.push_str(&format!("color:#{color};"));
        }
        if let Some(bold) = self.bold {
            css.push_str(if bold { "font-weight:700;" } else { "font-weight:400;" });
        }
        if self.italic == Some(true) {
            css.push_str("font-style:italic;");
        }
        match (self.underline, self.strike) {
            (Some(true), _) => css.push_str("text-decoration:underline;"),
            (_, Some(true)) => css.push_str("text-decoration:line-through;"),
            _ => {}
        }
        if block {
            if let Some(align) = &self.align {
                css.push_str(&format!("text-align:{align};"));
            }
            css.push_str(&format!("margin:{}pt 0 {}pt {}pt;", self.before.unwrap_or(0.0), self.after.unwrap_or(0.0), self.left.unwrap_or(0.0)));
            if let Some(line) = self.line {
                css.push_str(&format!("line-height:{line};"));
            }
            if let Some(shade) = &self.shade {
                css.push_str(&format!("background:#{shade};"));
            }
        }
        css
    }
}

fn attr<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attributes().find(|a| a.name() == name).map(|a| a.value())
}

fn child<'a, 'b>(node: Node<'a, 'b>, name: &str) -> Option<Node<'a, 'b>> {
    node.children().find(|n| n.tag_name().name() == name)
}

fn is_on(node: Node) -> bool {
    !matches!(attr(node, "val"), Some("0" | "false" | "none"))
}

fn is_hex(value: &str) -> bool {
    value.len() == 6 && value.bytes().all(|b| b.is_ascii_hexdigit())
}

fn hex(value: Option<&str>) -> Option<String> {
    value.filter(|v| is_hex(v)).map(String::from)
}

fn twips(node: Node, name: &str) -> Option<f32> {
    attr(node, name)?.parse::<f32>().ok().map(|v| v / TWIPS_PER_PT)
}

fn run_props(rpr: Node) -> Props {
    let mut p = Props::default();
    for n in rpr.children().filter(Node::is_element) {
        match n.tag_name().name() {
            "rFonts" => p.font = attr(n, "ascii").map(String::from),
            "sz" => p.size = attr(n, "val").and_then(|v| v.parse::<f32>().ok()).map(|v| v / 2.0),
            "color" => p.color = hex(attr(n, "val")),
            "b" => p.bold = Some(is_on(n)),
            "i" => p.italic = Some(is_on(n)),
            "u" => p.underline = Some(is_on(n)),
            "strike" => p.strike = Some(is_on(n)),
            _ => {}
        }
    }
    p
}

fn para_props(ppr: Node) -> Props {
    let mut p = Props::default();
    for n in ppr.children().filter(Node::is_element) {
        match n.tag_name().name() {
            "jc" => {
                p.align = match attr(n, "val") {
                    Some("center") => Some("center".into()),
                    Some("right" | "end") => Some("right".into()),
                    Some("both") => Some("justify".into()),
                    Some("left" | "start") => Some("left".into()),
                    _ => None,
                }
            }
            "spacing" => {
                p.before = twips(n, "before");
                p.after = twips(n, "after");
                if attr(n, "lineRule").is_none_or(|r| r == "auto") {
                    p.line = attr(n, "line").and_then(|v| v.parse::<f32>().ok()).map(|v| v / 240.0);
                }
            }
            "ind" => p.left = twips(n, "left"),
            "shd" => p.shade = hex(attr(n, "fill")),
            "pageBreakBefore" => p.page_break = Some(is_on(n)),
            _ => {}
        }
    }
    p
}

struct Style {
    based_on: Option<String>,
    props: Props,
}

struct Level {
    format: String,
    text: String,
    left: f32,
}

struct Context<'a> {
    styles: HashMap<String, Style>,
    defaults: Props,
    default_style: Option<String>,
    levels: HashMap<(String, u32), Level>,
    rels: HashMap<String, String>,
    parts: &'a Package,
    counters: HashMap<(String, u32), u32>,
}

impl Context<'_> {
    fn style(&self, id: Option<&str>) -> Props {
        let mut chain = Vec::new();
        let mut current = id.map(String::from).or(self.default_style.clone());
        while let Some(style) = current.as_deref().and_then(|c| self.styles.get(c)) {
            chain.push(style);
            if chain.len() >= MAX_STYLE_DEPTH {
                break;
            }
            current = style.based_on.clone();
        }
        chain.iter().rev().fold(self.defaults.clone(), |props, style| props.over(&style.props))
    }

    fn marker(&mut self, numbering: Node) -> Option<(String, f32)> {
        let num = attr(child(numbering, "numId")?, "val")?.to_string();
        let level: u32 = attr(child(numbering, "ilvl")?, "val")?.parse().ok()?;
        for deeper in (level + 1)..9 {
            self.counters.remove(&(num.clone(), deeper));
        }
        *self.counters.entry((num.clone(), level)).or_insert(0) += 1;
        let definition = self.levels.get(&(num.clone(), level))?;
        if definition.format == "bullet" {
            return Some((definition.text.clone(), definition.left));
        }
        let mut text = definition.text.clone();
        for shown in 0..=level {
            let value = self.counters.get(&(num.clone(), shown)).copied().unwrap_or(1);
            text = text.replace(&format!("%{}", shown + 1), &value.to_string());
        }
        Some((text, definition.left))
    }

    fn picture(&self, drawing: Node) -> Option<String> {
        let blip = drawing.descendants().find(|n| n.tag_name().name() == "blip")?;
        let target = self.rels.get(attr(blip, "embed")?)?;
        let bytes = self.parts.get(&format!("word/{target}"))?;
        let extent = drawing.descendants().find(|n| n.tag_name().name() == "extent")?;
        let width = attr(extent, "cx")?.parse::<f32>().ok()? / EMU_PER_PT;
        let height = attr(extent, "cy")?.parse::<f32>().ok()? / EMU_PER_PT;
        let mime = match target.rsplit('.').next()? {
            "png" => "image/png",
            "gif" => "image/gif",
            _ => "image/jpeg",
        };
        Some(format!(r#"<img alt="" src="data:{mime};base64,{}" style="width:{width}pt;height:{height}pt">"#, BASE64.encode(bytes)))
    }

    fn runs(&self, node: Node, field: &mut Field, out: &mut String) {
        for n in node.children().filter(Node::is_element) {
            match n.tag_name().name() {
                "r" => self.run(n, field, out),
                "hyperlink" | "smartTag" | "ins" | "sdt" | "sdtContent" | "fldSimple" => self.runs(n, field, out),
                _ => {}
            }
        }
    }

    fn run(&self, run: Node, field: &mut Field, out: &mut String) {
        let own = child(run, "rPr").map(run_props).unwrap_or_default();
        let linked = child(run, "rPr")
            .and_then(|r| child(r, "rStyle"))
            .and_then(|s| attr(s, "val"))
            .map(|id| self.style(Some(id)))
            .unwrap_or_default();
        let props = Props { color: own.color.clone().or(linked.color), underline: own.underline.or(linked.underline), ..own };
        let mut content = String::new();
        for n in run.children().filter(Node::is_element) {
            match n.tag_name().name() {
                "fldChar" => match attr(n, "fldCharType") {
                    Some("begin") => field.depth += 1,
                    Some("end") => {
                        field.depth = field.depth.saturating_sub(1);
                        if field.depth == 0 {
                            field.page = false;
                        }
                    }
                    _ => {}
                },
                "instrText" => {
                    if n.text().is_some_and(|t| t.trim_start().starts_with("PAGE")) {
                        field.page = true;
                        content.push_str(r#"<span class="page-number"></span>"#);
                    }
                }
                "t" if !field.page => content.push_str(&escape(n.text().unwrap_or(""))),
                "tab" => content.push_str("&emsp;"),
                "br" if attr(n, "type") != Some("page") => content.push_str("<br>"),
                "drawing" => content.push_str(&self.picture(n).unwrap_or_default()),
                "footnoteReference" => content.push_str(&format!("<sup>{}</sup>", attr(n, "id").map(escape).unwrap_or_default())),
                _ => {}
            }
        }
        if !content.is_empty() {
            out.push_str(&format!(r#"<span style="{}">{content}</span>"#, props.css(false)));
        }
    }

    fn paragraph(&mut self, para: Node, field: &mut Field) -> Block {
        let ppr = child(para, "pPr");
        let style = ppr.and_then(|p| child(p, "pStyle")).and_then(|s| attr(s, "val"));
        let mut props = self.style(style);
        if let Some(ppr) = ppr {
            props = props.over(&para_props(ppr));
        }
        let mut runs = String::new();
        if let Some((text, left)) = ppr.and_then(|p| child(p, "numPr")).and_then(|n| self.marker(n)) {
            props.left = Some(left);
            runs.push_str(&format!(r#"<span style="display:inline-block;min-width:1.4em">{}</span>"#, escape(&text)));
        }
        self.runs(para, field, &mut runs);
        if runs.is_empty() {
            runs.push_str("&nbsp;");
        }
        let page_break = props.page_break == Some(true)
            || para.descendants().any(|n| n.tag_name().name() == "br" && attr(n, "type") == Some("page"));
        Block { html: format!(r#"<p style="{}">{runs}</p>"#, props.css(true)), break_before: page_break }
    }

    fn table(&mut self, table: Node, field: &mut Field) -> Block {
        let mut html = String::from("<table>");
        for row in table.children().filter(|n| n.tag_name().name() == "tr") {
            html.push_str("<tr>");
            for cell in row.children().filter(|n| n.tag_name().name() == "tc") {
                html.push_str("<td>");
                for n in cell.children().filter(|n| n.tag_name().name() == "p") {
                    html.push_str(&self.paragraph(n, field).html);
                }
                html.push_str("</td>");
            }
            html.push_str("</tr>");
        }
        html.push_str("</table>");
        Block { html, break_before: false }
    }

    fn blocks(&mut self, node: Node, field: &mut Field, out: &mut Vec<Block>) {
        for n in node.children().filter(Node::is_element) {
            match n.tag_name().name() {
                "p" => {
                    let section_end = child(n, "pPr").is_some_and(|p| child(p, "sectPr").is_some());
                    out.push(self.paragraph(n, field));
                    if section_end {
                        out.push(Block { html: String::new(), break_before: true });
                    }
                }
                "tbl" => {
                    let table = self.table(n, field);
                    out.push(table);
                }
                "sdt" | "sdtContent" => self.blocks(n, field, out),
                _ => {}
            }
        }
    }
}

#[derive(Default)]
struct Field {
    depth: u32,
    page: bool,
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn text_part<'a>(parts: &'a Package, name: &str) -> Option<&'a str> {
    parts.get(name).and_then(|b| std::str::from_utf8(b).ok())
}

fn parse<'a>(text: &'a str) -> Result<Document<'a>> {
    Document::parse(text).map_err(|e| Error::Vault(format!("could not read the document: {e}")))
}

fn load_styles(context: &mut Context, parts: &Package) -> Result<()> {
    let Some(text) = text_part(parts, "word/styles.xml") else { return Ok(()) };
    let document = parse(text)?;
    let root = document.root_element();
    if let Some(defaults) = child(root, "docDefaults") {
        let run = child(defaults, "rPrDefault").and_then(|n| child(n, "rPr")).map(run_props).unwrap_or_default();
        let para = child(defaults, "pPrDefault").and_then(|n| child(n, "pPr")).map(para_props).unwrap_or_default();
        context.defaults = run.over(&para);
    }
    for style in root.children().filter(|n| n.tag_name().name() == "style") {
        let Some(id) = attr(style, "styleId") else { continue };
        if attr(style, "default") == Some("1") && attr(style, "type") == Some("paragraph") {
            context.default_style = Some(id.to_string());
        }
        let run = child(style, "rPr").map(run_props).unwrap_or_default();
        let para = child(style, "pPr").map(para_props).unwrap_or_default();
        let based_on = child(style, "basedOn").and_then(|n| attr(n, "val")).map(String::from);
        context.styles.insert(id.to_string(), Style { based_on, props: run.over(&para) });
    }
    Ok(())
}

fn load_numbering(context: &mut Context, parts: &Package) -> Result<()> {
    let Some(text) = text_part(parts, "word/numbering.xml") else { return Ok(()) };
    let document = parse(text)?;
    let root = document.root_element();
    for num in root.children().filter(|n| n.tag_name().name() == "num") {
        let (Some(id), Some(source)) = (attr(num, "numId"), child(num, "abstractNumId").and_then(|n| attr(n, "val"))) else { continue };
        let definition = root.children().find(|n| n.tag_name().name() == "abstractNum" && attr(*n, "abstractNumId") == Some(source));
        for level in definition.into_iter().flat_map(|d| d.children()).filter(|n| n.tag_name().name() == "lvl") {
            let Some(index) = attr(level, "ilvl").and_then(|v| v.parse::<u32>().ok()) else { continue };
            let format = child(level, "numFmt").and_then(|n| attr(n, "val")).unwrap_or("decimal").to_string();
            let text = child(level, "lvlText").and_then(|n| attr(n, "val")).unwrap_or("").to_string();
            let left = child(level, "pPr").and_then(|p| child(p, "ind")).and_then(|i| twips(i, "left")).unwrap_or(18.0);
            context.levels.insert((id.to_string(), index), Level { format, text, left });
        }
    }
    Ok(())
}

fn furniture(context: &mut Context, section: Option<Node>, kind: &str) -> Result<String> {
    let reference = section.and_then(|s| {
        s.children().find(|n| n.tag_name().name() == format!("{kind}Reference") && attr(*n, "type") == Some("default"))
    });
    let Some(id) = reference.and_then(|r| attr(r, "id")) else { return Ok(String::new()) };
    let Some(target) = context.rels.get(id).cloned() else { return Ok(String::new()) };
    let parts = context.parts;
    let Some(text) = text_part(parts, &format!("word/{target}")) else { return Ok(String::new()) };
    let document = parse(text)?;
    let mut blocks = Vec::new();
    context.blocks(document.root_element(), &mut Field::default(), &mut blocks);
    Ok(blocks.into_iter().map(|b| b.html).collect())
}

/// Reads a `.docx` into blocks for the preview to lay out on pages.
pub fn render(docx: &[u8]) -> Result<Preview> {
    let parts = read_package(docx)?;
    let mut context = Context {
        styles: HashMap::new(),
        defaults: Props::default(),
        default_style: None,
        levels: HashMap::new(),
        rels: HashMap::new(),
        parts: &parts,
        counters: HashMap::new(),
    };
    load_styles(&mut context, &parts)?;
    load_numbering(&mut context, &parts)?;
    if let Some(text) = text_part(&parts, "word/_rels/document.xml.rels") {
        let document = parse(text)?;
        for rel in document.root_element().children().filter(Node::is_element) {
            if let (Some(id), Some(target)) = (attr(rel, "Id"), attr(rel, "Target")) {
                context.rels.insert(id.to_string(), target.to_string());
            }
        }
    }
    let text = text_part(&parts, "word/document.xml").ok_or_else(|| Error::Vault("no document part".into()))?;
    let document = parse(text)?;
    let body = child(document.root_element(), "body").ok_or_else(|| Error::Vault("no document body".into()))?;
    let section = child(body, "sectPr");
    let size = section.and_then(|s| child(s, "pgSz"));
    let margin = section.and_then(|s| child(s, "pgMar"));
    let header = furniture(&mut context, section, "header")?;
    let footer = furniture(&mut context, section, "footer")?;
    let mut blocks = Vec::new();
    context.blocks(body, &mut Field::default(), &mut blocks);
    Ok(Preview {
        width: size.and_then(|n| twips(n, "w")).unwrap_or(595.3),
        height: size.and_then(|n| twips(n, "h")).unwrap_or(841.9),
        top: margin.and_then(|n| twips(n, "top")).unwrap_or(72.0),
        right: margin.and_then(|n| twips(n, "right")).unwrap_or(72.0),
        bottom: margin.and_then(|n| twips(n, "bottom")).unwrap_or(72.0),
        left: margin.and_then(|n| twips(n, "left")).unwrap_or(72.0),
        header,
        footer,
        title_page: section.is_some_and(|s| child(s, "titlePg").is_some()),
        blocks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docx::{Input, Section, example_template};

    fn generated(markdown: &str) -> Preview {
        let sections = vec![Section::Note { path: "n.md".into(), markdown: markdown.into(), shift: 0, page_break: false }];
        let template = example_template();
        let image = |_: &str, _: &str| None;
        let input = Input { sections: &sections, title: "t", fixed_title: false, date: "5/11", contents: "Índice", diagrams: &[], image: &image, template: Some(&template) };
        render(&crate::docx::render(&input).unwrap()).unwrap()
    }

    #[test]
    fn shows_the_styles_of_the_generated_document() {
        let preview = generated("---\nautor: Ane\n---\n# Título & más\n\n- uno\n\n1. dos\n\n| A |\n|---|\n| 1 |\n");
        let html: String = preview.blocks.iter().map(|b| b.html.as_str()).collect();
        assert!(html.contains("color:#1F3A5F") && html.contains("font-size:17pt"), "the heading style resolves");
        assert!(html.contains("font-family:'Georgia'"), "defaults apply");
        assert!(html.contains("Título &amp; más"), "text is escaped");
        assert!(html.contains("•") && html.contains("1.") && html.contains("<table>"));
        assert!(html.contains("Ane"));
        assert!(preview.title_page);
        assert!((preview.width - 595.3).abs() < 0.1);
    }

    #[test]
    fn page_breaks_and_furniture_are_reported() {
        let preview = generated("# Uno\n");
        assert!(preview.blocks.iter().filter(|b| b.break_before).count() >= 2, "contents and body");
        assert!(preview.header.contains("Uno"));
        assert!(preview.footer.contains("page-number"));
    }
}
