//! Works out which of a template's own styles a document should be written with.
//! Corporate templates often number their titles with styles of their own, built
//! on the standard headings, and write their text in a style other than Normal.

use roxmltree::{Document, Node};
use std::collections::HashMap;

const HEADING_LEVELS: usize = 6;
/// A style used fewer times than this says little about the document.
const MIN_BODY_USES: usize = 3;
/// Names of styles that are never the body text, in lowercase.
const NOT_BODY: &[&str] = &["toc", "heading", "header", "footer", "title", "subtitle", "caption", "footnote"];

/// What a template asks for. None keeps the standard style.
#[derive(Debug, Default, PartialEq)]
pub struct Detected {
    /// Style id for each heading level, from level 1.
    pub headings: [Option<String>; HEADING_LEVELS],
    pub body: Option<String>,
    /// The list that numbers those headings.
    pub heading_list: Option<String>,
    /// The list to write on levels past those styles whose standard heading
    /// numbers elsewhere; `0` takes the number away.
    pub loose_levels: [Option<String>; HEADING_LEVELS],
    /// Background of the first filled cell of the template, as `RRGGBB`.
    pub header_fill: Option<String>,
}

struct Style {
    name: String,
    based_on: Option<String>,
    paragraph: bool,
    default: bool,
    /// Sets its own numbering, instead of inheriting it.
    numbered: bool,
}

fn attr<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    node.attributes().find(|a| a.name() == name).map(|a| a.value())
}

fn child<'a, 'b>(node: Node<'a, 'b>, name: &str) -> Option<Node<'a, 'b>> {
    node.children().find(|n| n.tag_name().name() == name)
}

fn value<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    child(node, name).and_then(|n| attr(n, "val"))
}

fn load_styles(xml: &str) -> HashMap<String, Style> {
    let Ok(document) = Document::parse(xml) else { return HashMap::new() };
    document
        .root_element()
        .children()
        .filter(|n| n.tag_name().name() == "style")
        .filter_map(|n| {
            let style = Style {
                name: value(n, "name")?.to_lowercase(),
                based_on: value(n, "basedOn").map(String::from),
                paragraph: attr(n, "type") == Some("paragraph"),
                default: matches!(attr(n, "default"), Some("1" | "true")),
                numbered: child(n, "pPr").and_then(|p| child(p, "numPr")).is_some(),
            };
            Some((attr(n, "styleId")?.to_string(), style))
        })
        .collect()
}

/// Whether a style is built on another, through any number of steps.
fn derives_from(styles: &HashMap<String, Style>, id: &str, ancestor: &str) -> bool {
    let mut current = styles.get(id).and_then(|s| s.based_on.as_deref());
    for _ in 0..styles.len() {
        match current {
            Some(next) if next == ancestor => return true,
            Some(next) => current = styles.get(next).and_then(|s| s.based_on.as_deref()),
            None => return false,
        }
    }
    false
}

/// A list definition: its id, and the style tied to each of its levels.
type List = (String, HashMap<usize, String>);

fn linked_styles(xml: &str) -> Vec<List> {
    let Ok(document) = Document::parse(xml) else { return Vec::new() };
    document
        .root_element()
        .children()
        .filter(|n| n.tag_name().name() == "abstractNum")
        .map(|list| {
            let levels = list
                .children()
                .filter(|n| n.tag_name().name() == "lvl")
                .filter_map(|level| Some((attr(level, "ilvl")?.parse().ok()?, value(level, "pStyle")?.to_string())))
                .collect();
            (attr(list, "abstractNumId").unwrap_or_default().to_string(), levels)
        })
        .collect()
}

/// The number paragraphs use to join a list definition.
fn list_number(xml: &str, definition: &str) -> Option<String> {
    let document = Document::parse(xml).ok()?;
    document
        .root_element()
        .children()
        .filter(|n| n.tag_name().name() == "num")
        .find(|n| value(*n, "abstractNumId") == Some(definition))
        .and_then(|n| attr(n, "numId"))
        .map(String::from)
}

/// Whether a list definition counts this level, as `%4` does for the fourth.
fn counts_level(xml: &str, definition: &str, slot: usize) -> bool {
    let Ok(document) = Document::parse(xml) else { return false };
    let counter = format!("%{}", slot + 1);
    document
        .root_element()
        .children()
        .filter(|n| n.tag_name().name() == "abstractNum" && attr(*n, "abstractNumId").unwrap_or_default() == definition)
        .flat_map(|list| list.children().filter(|n| n.tag_name().name() == "lvl"))
        .any(|level| {
            attr(level, "ilvl") == Some(slot.to_string().as_str())
                && value(level, "lvlText").is_some_and(|text| text.contains(&counter))
        })
}

/// The colour a template gives its tables, from the first filled cell it has.
fn table_fill(document: &str) -> Option<String> {
    let parsed = Document::parse(document).ok()?;
    parsed
        .descendants()
        .filter(|n| n.tag_name().name() == "tcPr")
        .filter_map(|cell| attr(child(cell, "shd")?, "fill"))
        .find(|fill| {
            fill.len() == 6 && !fill.eq_ignore_ascii_case("FFFFFF") && fill.bytes().all(|b| b.is_ascii_hexdigit())
        })
        .map(str::to_uppercase)
}

/// The styles of one list that continue the standard headings, level by level.
/// It stops at the first gap: a style outside the list would break the numbering,
/// however closely its name or look follows the others.
fn heading_chain(styles: &HashMap<String, Style>, list: &HashMap<usize, String>) -> Vec<String> {
    let heading_id = |level: usize| {
        let name = format!("heading {level}");
        styles.iter().find(|(_, s)| s.name == name).map(|(id, _)| id.as_str())
    };
    let mut chain = Vec::new();
    for level in 1..=HEADING_LEVELS {
        let (Some(id), Some(heading)) = (list.get(&(level - 1)), heading_id(level)) else { break };
        if !derives_from(styles, id, heading) {
            break;
        }
        chain.push(id.clone());
    }
    chain
}

/// The style names a contents field lists, in lowercase, in their order.
fn contents_styles(document: &str) -> Vec<String> {
    let Ok(parsed) = Document::parse(document) else { return Vec::new() };
    let field: String = parsed
        .descendants()
        .filter(|n| n.tag_name().name() == "instrText")
        .filter_map(|n| n.text())
        .filter(|text| text.contains("TOC"))
        .collect();
    let Some(list) = super::TOC_STYLES.captures(&field) else { return Vec::new() };
    let pairs: Vec<&str> = list[1].split([';', ',']).collect();
    pairs.as_chunks::<2>().0.iter().map(|pair| pair[0].trim().to_lowercase()).collect()
}

/// A variant of a heading style that the contents list and that keeps its
/// numbering. Templates use these to add, say, a page break to each chapter. One
/// with numbering of its own is left out, because it would break the sequence.
fn listed_variant(styles: &HashMap<String, Style>, id: &str, listed: &[String]) -> Option<String> {
    listed.iter().find_map(|name| {
        let (variant, _) = styles.iter().find(|(_, s)| s.name == *name && !s.numbered)?;
        derives_from(styles, variant, id).then(|| variant.clone())
    })
}

fn body_style(styles: &HashMap<String, Style>, document: &str) -> Option<String> {
    let parsed = Document::parse(document).ok()?;
    let mut uses: HashMap<&str, usize> = HashMap::new();
    for paragraph in parsed.descendants().filter(|n| n.tag_name().name() == "pStyle") {
        if let Some(id) = attr(paragraph, "val") {
            *uses.entry(id).or_default() += 1;
        }
    }
    let mut candidates: Vec<(&str, usize)> = uses
        .into_iter()
        .filter(|(id, count)| {
            *count >= MIN_BODY_USES
                && styles
                    .get(*id)
                    .is_some_and(|s| s.paragraph && !s.default && !NOT_BODY.iter().any(|word| s.name.starts_with(word)))
        })
        .collect();
    // The name settles a tie, so the same template always gives the same answer.
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
    candidates.first().map(|(id, _)| id.to_string())
}

pub fn detect(styles_xml: &str, numbering_xml: &str, document_xml: &str) -> Detected {
    let styles = load_styles(styles_xml);
    let (definition, chain) = linked_styles(numbering_xml)
        .iter()
        .map(|(id, list)| (id.clone(), heading_chain(&styles, list)))
        .max_by_key(|(_, chain)| chain.len())
        .unwrap_or_default();
    let listed = contents_styles(document_xml);
    let mut detected = Detected {
        body: body_style(&styles, document_xml),
        heading_list: if chain.is_empty() { None } else { list_number(numbering_xml, &definition) },
        header_fill: table_fill(document_xml),
        ..Detected::default()
    };
    if let Some(list) = detected.heading_list.clone() {
        // Left alone, they would count from 1 in a list that nothing else uses.
        for slot in chain.len()..HEADING_LEVELS {
            let name = format!("heading {}", slot + 1);
            if styles.values().any(|s| s.name == name && s.numbered) {
                detected.loose_levels[slot] =
                    Some(if counts_level(numbering_xml, &definition, slot) { list.clone() } else { "0".into() });
            }
        }
    }
    for (slot, id) in detected.headings.iter_mut().zip(chain) {
        *slot = Some(listed_variant(&styles, &id, &listed).unwrap_or(id));
    }
    detected
}

#[cfg(test)]
mod tests {
    use super::*;

    const NS: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main""#;

    fn style(id: &str, name: &str, based_on: &str) -> String {
        let parent = if based_on.is_empty() { String::new() } else { format!(r#"<w:basedOn w:val="{based_on}"/>"#) };
        format!(r#"<w:style w:type="paragraph" w:styleId="{id}"><w:name w:val="{name}"/>{parent}</w:style>"#)
    }

    fn styles() -> String {
        let all = [
            r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>"#
                .to_string(),
            style("Tit1", "heading 1", "Normal"),
            style("Tit2", "heading 2", "Normal"),
            style("Tit3", "heading 3", "Normal"),
            style("Propio1", "Propio 1", "Tit1"),
            style("Propio2", "Propio 2", "Tit2"),
            style("Propio3", "Propio 3", "Tit3"),
            style("Propio3Bis", "Propio 3 Bis", "Propio3"),
            style("Cuerpo", "Cuerpo", "Normal"),
            style("Dato", "Dato", "Normal"),
            style("TDC1", "toc 1", "Normal"),
        ];
        format!("<w:styles {NS}>{}</w:styles>", all.concat())
    }

    fn numbering(lists: &[&[&str]]) -> String {
        let body: String = lists
            .iter()
            .map(|levels| {
                let levels: String = levels
                    .iter()
                    .enumerate()
                    .map(|(i, id)| format!(r#"<w:lvl w:ilvl="{i}"><w:pStyle w:val="{id}"/></w:lvl>"#))
                    .collect();
                format!("<w:abstractNum>{levels}</w:abstractNum>")
            })
            .collect();
        format!("<w:numbering {NS}>{body}</w:numbering>")
    }

    fn document(uses: &[(&str, usize)]) -> String {
        let body: String = uses
            .iter()
            .flat_map(|(id, n)| {
                std::iter::repeat_n(format!(r#"<w:p><w:pPr><w:pStyle w:val="{id}"/></w:pPr></w:p>"#,), *n)
            })
            .collect();
        format!("<w:document {NS}><w:body>{body}</w:body></w:document>")
    }

    #[test]
    fn finds_the_styles_that_number_the_headings() {
        let found = detect(&styles(), &numbering(&[&["Tit2"], &["Propio1", "Propio2", "Propio3"]]), &document(&[]));
        assert_eq!(found.headings[..3], [Some("Propio1".into()), Some("Propio2".into()), Some("Propio3".into())]);
        assert_eq!(found.headings[3], None, "there is no fourth level");
    }

    #[test]
    fn a_style_outside_the_list_is_not_taken_for_its_looks() {
        // Propio3Bis derives from Propio3 and looks the part, but no list uses it.
        let found =
            detect(&styles(), &numbering(&[&["Propio1", "Propio2", "Propio3"]]), &document(&[("Propio3Bis", 9)]));
        assert_eq!(found.headings[2], Some("Propio3".into()));
    }

    #[test]
    fn the_chain_stops_at_the_first_level_that_does_not_fit() {
        let found = detect(&styles(), &numbering(&[&["Propio1", "Cuerpo", "Propio3"]]), &document(&[]));
        assert_eq!(found.headings[..3], [Some("Propio1".into()), None, None]);
    }

    #[test]
    fn standard_headings_in_a_list_are_kept_as_they_are() {
        let found = detect(&styles(), &numbering(&[&["Tit1", "Tit2"]]), &document(&[]));
        assert_eq!(found.headings, Detected::default().headings);
    }

    fn with_numbering(id: &str, name: &str, based_on: &str) -> String {
        style(id, name, based_on)
            .replace("</w:style>", r#"<w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>"#)
    }

    fn contents(list: &str) -> String {
        format!(
            r#"<w:document {NS}><w:body><w:p><w:r><w:instrText> TOC \o "2-3" \t "{list}" </w:instrText></w:r></w:p></w:body></w:document>"#
        )
    }

    #[test]
    fn a_variant_in_the_contents_replaces_the_style_if_it_keeps_the_numbering() {
        let all = styles().replace(
            "</w:styles>",
            &format!(
                "{}{}</w:styles>",
                style("Capitulo", "Capitulo", "Propio1"),
                with_numbering("Otra", "Otra", "Propio2")
            ),
        );
        let list = numbering(&[&["Propio1", "Propio2"]]);
        let found = detect(&all, &list, &contents("Capitulo;1;Otra;2"));
        assert_eq!(found.headings[0].as_deref(), Some("Capitulo"), "it adds to the style and numbers the same");
        assert_eq!(found.headings[1].as_deref(), Some("Propio2"), "numbering of its own would break the sequence");
    }

    #[test]
    fn a_style_in_the_contents_that_is_no_variant_is_ignored() {
        let found = detect(&styles(), &numbering(&[&["Propio1"]]), &contents("Cuerpo;1"));
        assert_eq!(found.headings[0].as_deref(), Some("Propio1"));
    }

    #[test]
    fn the_body_is_the_most_used_ordinary_style() {
        let found = detect(&styles(), "", &document(&[("TDC1", 20), ("Dato", 4), ("Cuerpo", 9), ("Normal", 30)]));
        assert_eq!(found.body.as_deref(), Some("Cuerpo"));
    }

    #[test]
    fn a_style_used_a_couple_of_times_is_not_the_body() {
        assert_eq!(detect(&styles(), "", &document(&[("Cuerpo", 2)])).body, None);
    }

    #[test]
    fn a_template_without_these_parts_changes_nothing() {
        assert_eq!(detect("", "", ""), Detected::default());
        assert_eq!(detect("not xml", "<", ">"), Detected::default());
    }

    #[test]
    fn the_header_colour_comes_from_the_first_filled_cell() {
        let cell = |fill: &str| format!(r#"<w:tc><w:tcPr><w:shd w:val="clear" w:fill="{fill}"/></w:tcPr></w:tc>"#);
        let tables = format!(
            "<w:document {NS}><w:body><w:tbl>{}{}{}</w:tbl></w:body></w:document>",
            cell("auto"),
            cell("FFFFFF"),
            cell("a1b2c3")
        );
        assert_eq!(detect("", "", &tables).header_fill.as_deref(), Some("A1B2C3"));
    }

    /// Two levels with styles of their own, in a list that defines a third.
    fn short_list(third: &str) -> String {
        let levels = format!(
            r#"<w:lvl w:ilvl="0"><w:pStyle w:val="Propio1"/></w:lvl><w:lvl w:ilvl="1"><w:pStyle w:val="Propio2"/></w:lvl><w:lvl w:ilvl="2"><w:lvlText w:val="{third}"/></w:lvl>"#
        );
        format!(
            r#"<w:numbering {NS}><w:abstractNum w:abstractNumId="5">{levels}</w:abstractNum><w:num w:numId="9"><w:abstractNumId w:val="5"/></w:num></w:numbering>"#
        )
    }

    fn numbered_third_heading() -> String {
        styles().replace(&style("Tit3", "heading 3", "Normal"), &with_numbering("Tit3", "heading 3", "Normal"))
    }

    #[test]
    fn a_heading_numbered_elsewhere_continues_in_the_list_that_has_its_level() {
        let found = detect(&numbered_third_heading(), &short_list("%1.%2.%3."), &document(&[]));
        assert_eq!(found.headings[2], None);
        assert_eq!(found.loose_levels[2].as_deref(), Some("9"));
        assert_eq!(found.loose_levels[0], None, "that level has its style");
        assert_eq!(found.loose_levels[3], None, "the template has no such heading");
    }

    #[test]
    fn a_heading_numbered_elsewhere_loses_the_number_if_the_list_stops_before_it() {
        let found = detect(&numbered_third_heading(), &short_list("%3"), &document(&[]));
        assert_eq!(found.loose_levels[2].as_deref(), Some("9"));
        let found = detect(&numbered_third_heading(), &short_list("-"), &document(&[]));
        assert_eq!(found.loose_levels[2].as_deref(), Some("0"));
    }

    #[test]
    fn a_heading_without_a_number_is_left_as_the_template_has_it() {
        assert_eq!(
            detect(&styles(), &short_list("%1.%2.%3."), &document(&[])).loose_levels,
            Detected::default().loose_levels
        );
    }

    #[test]
    fn the_list_of_the_headings_is_found_by_its_number() {
        let list = numbering(&[&["Propio1", "Propio2"]])
            .replace("<w:abstractNum>", r#"<w:abstractNum w:abstractNumId="5">"#)
            .replace("</w:numbering>", r#"<w:num w:numId="9"><w:abstractNumId w:val="5"/></w:num></w:numbering>"#);
        assert_eq!(detect(&styles(), &list, &document(&[])).heading_list.as_deref(), Some("9"));
    }

    #[test]
    fn a_style_chain_that_loops_ends() {
        let looped = format!("<w:styles {NS}>{}{}</w:styles>", style("A", "a", "B"), style("B", "b", "A"));
        assert_eq!(detect(&looped, &numbering(&[&["A"]]), ""), Detected::default());
    }
}
