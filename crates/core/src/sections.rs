//! A note as a tree of sections, so that a part of it can be read or changed
//! without rewriting the rest. A section runs from its heading to the next
//! heading of the same level or higher. Headings inside code blocks and the
//! properties at the top do not count.

use crate::search::fold;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: usize,
    pub text: String,
    /// Line of the heading, counting from 1.
    pub line: usize,
    /// Last line of its section, headings below it included.
    pub end_line: usize,
}

/// `## Text` as (2, "Text"), for an ATX heading.
fn heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let level = trimmed.chars().take_while(|c| *c == '#').count();
    let rest = &trimmed[level..];
    if !(1..=6).contains(&level) || !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let text = rest.trim().trim_end_matches('#').trim_end();
    Some((level, text.to_string()))
}

/// The headings of a note, in order, each with where its section ends.
pub fn outline(content: &str) -> Vec<Heading> {
    let lines: Vec<&str> = content.lines().collect();
    let mut start = 0;
    if lines.first().is_some_and(|l| l.trim_end() == "---")
        && let Some(close) = lines.iter().skip(1).position(|l| l.trim_end() == "---")
    {
        start = close + 2;
    }
    let mut found: Vec<Heading> = Vec::new();
    let mut fence: Option<&str> = None;
    for (i, line) in lines.iter().enumerate().skip(start) {
        let trimmed = line.trim_start();
        if let Some(open) = fence {
            if trimmed.starts_with(open) {
                fence = None;
            }
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            fence = Some(&trimmed[..3]);
            continue;
        }
        if let Some((level, text)) = heading(line) {
            found.push(Heading { level, text, line: i + 1, end_line: lines.len() });
        }
    }
    for i in 0..found.len() {
        if let Some(next) = found[i + 1..].iter().find(|h| h.level <= found[i].level) {
            found[i].end_line = next.line - 1;
        }
    }
    found
}

/// The heading named `text`, ignoring case and accents. When the name is
/// repeated, `line` says which one is meant.
pub fn find<'a>(headings: &'a [Heading], text: &str, line: Option<usize>) -> Result<&'a Heading> {
    let wanted = fold(text.trim().trim_start_matches('#').trim());
    let matches: Vec<&Heading> = headings.iter().filter(|h| fold(&h.text) == wanted).collect();
    match (matches.as_slice(), line) {
        ([], _) => Err(Error::NotFound(format!("heading '{text}'"))),
        (_, Some(line)) => matches
            .into_iter()
            .find(|h| h.line == line)
            .ok_or_else(|| Error::NotFound(format!("heading '{text}' at line {line}"))),
        ([only], None) => Ok(only),
        (many, None) => {
            let lines: Vec<String> = many.iter().map(|h| h.line.to_string()).collect();
            Err(Error::Vault(format!(
                "heading '{text}' appears {} times, at lines {}; pass heading_line",
                many.len(),
                lines.join(", ")
            )))
        }
    }
}

/// The text of a section, its heading line included.
pub fn section_text(content: &str, heading: &Heading) -> String {
    content.lines().skip(heading.line - 1).take(heading.end_line - heading.line + 1).collect::<Vec<_>>().join("\n")
}

/// Where to put text in a section.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    /// Right under the heading.
    Start,
    /// At the end of the section, before the next heading of its level.
    End,
    /// Instead of everything under the heading, which stays.
    Replace,
}

/// The note with `text` put into the section of `heading`.
pub fn insert(content: &str, heading: &Heading, place: Place, text: &str) -> String {
    let newline = if content.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<&str> = content.lines().collect();
    let body_start = heading.line; // index of the first line under the heading
    let mut body_end = heading.end_line; // index just past the section
    // Blank lines closing a section stay between it and the next heading.
    if place != Place::Start {
        while body_end > body_start && lines[body_end - 1].trim().is_empty() {
            body_end -= 1;
        }
    }
    let new: Vec<&str> = text.trim_end_matches(['\n', '\r']).lines().collect();
    match place {
        Place::Start => {
            lines.splice(body_start..body_start, new);
        }
        Place::End => {
            lines.splice(body_end..body_end, new);
        }
        Place::Replace => {
            lines.splice(body_start..body_end, new);
        }
    }
    let mut out = lines.join(newline);
    if content.ends_with('\n') {
        out.push_str(newline);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "---\ntitulo: x\n---\n# Plan\nintro\n## Fechas\nmarzo\n\n```\n# no es título\n```\n## Coste\n100\n# Anexo\nfin\n";

    #[test]
    fn outline_knows_where_each_section_ends() {
        let found = outline(NOTE);
        let summary: Vec<_> = found.iter().map(|h| (h.level, h.text.as_str(), h.line, h.end_line)).collect();
        assert_eq!(summary, [(1, "Plan", 4, 13), (2, "Fechas", 6, 11), (2, "Coste", 12, 13), (1, "Anexo", 14, 15)]);
        assert!(outline("#etiqueta\n#nope").is_empty());
    }

    #[test]
    fn headings_are_found_by_name() {
        let found = outline("# A\n## Notas\n# B\n## notas\n");
        assert!(find(&found, "notas", None).unwrap_err().to_string().contains("lines 2, 4"));
        assert_eq!(find(&found, "Notas", Some(4)).unwrap().line, 4);
        assert_eq!(find(&found, "## a", None).unwrap().line, 1);
        assert!(find(&found, "C", None).is_err());
    }

    #[test]
    fn text_goes_where_asked() {
        let found = outline(NOTE);
        let fechas = find(&found, "Fechas", None).unwrap();
        assert_eq!(section_text(NOTE, fechas), "## Fechas\nmarzo\n\n```\n# no es título\n```");
        let end = insert(NOTE, fechas, Place::End, "abril\n");
        assert!(end.contains("```\nabril\n## Coste"), "{end}");
        let start = insert(NOTE, fechas, Place::Start, "primero");
        assert!(start.contains("## Fechas\nprimero\nmarzo"), "{start}");
        let coste = find(&found, "Coste", None).unwrap();
        let replaced = insert(NOTE, coste, Place::Replace, "200");
        assert!(replaced.contains("## Coste\n200\n# Anexo"), "{replaced}");
        assert!(replaced.ends_with("fin\n"));
    }

    #[test]
    fn blank_lines_before_the_next_heading_stay() {
        let note = "# A\nuno\n\n# B\n";
        let a = &outline(note)[0];
        assert_eq!(insert(note, a, Place::End, "dos"), "# A\nuno\ndos\n\n# B\n");
        let crlf = "# A\r\nuno\r\n";
        assert_eq!(insert(crlf, &outline(crlf)[0], Place::End, "dos"), "# A\r\nuno\r\ndos\r\n");
    }
}
