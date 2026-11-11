//! Links between the notes of one exported document. A link to a note, or to
//! one of its headings, that is part of the same document jumps there, and it
//! reads as that place's title rather than as a file name. The notes on disk
//! keep their links as written.
//!
//! [`bodies`] prepares every note for the Word and PDF writers, which then
//! mark each note's start with [`note_anchor`] and its headings, counted in
//! order, with [`heading_anchor`]. A rewritten link points to `#` and one of
//! those names, which [`internal`] recognises.

use crate::docx::{Section, normalize_wikilinks, split_frontmatter};
use crate::search::fold;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::{Captures, Regex};
use std::sync::LazyLock;

/// The parser options both writers use.
pub const OPTIONS: Options = Options::ENABLE_TABLES
    .union(Options::ENABLE_FOOTNOTES)
    .union(Options::ENABLE_STRIKETHROUGH)
    .union(Options::ENABLE_TASKLISTS)
    .union(Options::ENABLE_GFM);

const PREFIX: &str = "umd";

static WIKI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(!?)\[\[([^\]\n]*)\]\]").unwrap());
static MARKDOWN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(!?)\[([^\]\n]*)\]\(([^)\s]+)\)").unwrap());

/// Where a note of the document starts, by its place among the sections.
pub fn note_anchor(section: usize) -> String {
    format!("{PREFIX}{section}")
}

/// The `heading`-th heading of a note, counting from 0.
pub fn heading_anchor(section: usize, heading: usize) -> String {
    format!("{PREFIX}{section}_{heading}")
}

/// The anchor a link leads to, when it was rewritten here.
pub fn internal(dest: &str) -> Option<&str> {
    let name = dest.strip_prefix('#')?;
    let rest = name.strip_prefix(PREFIX)?;
    (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit() || c == '_')).then_some(name)
}

/// One note as the writers will read it.
struct Prepared {
    path: String,
    title: String,
    headings: Vec<String>,
}

/// Every section's Markdown ready to parse, without frontmatter, with links
/// within the document rewritten. Headings from the export plan give "".
pub fn bodies(sections: &[Section], language: &str) -> Vec<String> {
    let cleaned: Vec<Option<String>> = sections
        .iter()
        .map(|s| match s {
            Section::Note { markdown, .. } => Some(crate::marks::strip(split_frontmatter(markdown).1)),
            Section::Heading { .. } => None,
        })
        .collect();
    let notes: Vec<Option<Prepared>> = sections
        .iter()
        .zip(&cleaned)
        .map(|(s, body)| match (s, body) {
            (Section::Note { path, markdown, .. }, Some(body)) => {
                let headings = headings(&finish(body, language));
                let meta = split_frontmatter(markdown).0;
                let title = meta
                    .get("titulo")
                    .or(meta.get("title"))
                    .filter(|t| !t.is_empty())
                    .cloned()
                    .or_else(|| headings.first().cloned())
                    .unwrap_or_else(|| stem(path).to_string());
                Some(Prepared { path: path.clone(), title, headings })
            }
            _ => None,
        })
        .collect();
    let paths: Vec<String> = notes.iter().flatten().map(|n| n.path.clone()).collect();
    cleaned
        .iter()
        .enumerate()
        .map(|(index, body)| match body {
            Some(body) => {
                let from = notes[index].as_ref().map_or("", |n| n.path.as_str());
                finish(&rewrite(body, index, from, &notes, &paths), language)
            }
            None => String::new(),
        })
        .collect()
}

fn finish(body: &str, language: &str) -> String {
    normalize_wikilinks(&crate::callouts::normalize(body, language))
}

fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

/// The text of each heading, in order, as the writers will meet them.
fn headings(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    for event in Parser::new_ext(body, OPTIONS) {
        match event {
            Event::Start(Tag::Heading { .. }) => current = Some(String::new()),
            Event::End(TagEnd::Heading(_)) => out.extend(current.take().map(|t| t.trim().to_string())),
            Event::Text(t) | Event::Code(t) => {
                if let Some(c) = &mut current {
                    c.push_str(&t);
                }
            }
            _ => {}
        }
    }
    out
}

/// How a heading is written in a Markdown fragment: folded, with spaces as dashes.
fn slug(text: &str) -> String {
    let folded = fold(text);
    let kept: String = folded.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_').collect();
    kept.split_whitespace().collect::<Vec<_>>().join("-")
}

/// The place a link names: which section, and which heading if any.
fn locate(notes: &[Option<Prepared>], index: usize, fragment: Option<&str>) -> Option<(String, String)> {
    let note = notes[index].as_ref()?;
    let wanted = fragment.map(str::trim).filter(|f| !f.is_empty() && !f.starts_with('^'));
    let Some(wanted) = wanted else {
        return Some((note_anchor(index), note.title.clone()));
    };
    let decoded = wanted.replace("%20", " ");
    let found = note.headings.iter().position(|h| fold(h) == fold(&decoded) || slug(h) == slug(&decoded))?;
    Some((heading_anchor(index, found), note.headings[found].clone()))
}

fn section_of(notes: &[Option<Prepared>], path: &str) -> Option<usize> {
    notes.iter().position(|n| n.as_ref().is_some_and(|n| n.path == path))
}

fn rewrite(body: &str, index: usize, from: &str, notes: &[Option<Prepared>], paths: &[String]) -> String {
    outside_code(body, |text| {
        let wiki = WIKI.replace_all(text, |c: &Captures| {
            if !c[1].is_empty() {
                return c[0].to_string();
            }
            let (target, alias) = c[2].split_once('|').map_or((&c[2], None), |(t, a)| (t, Some(a.trim())));
            let (name, fragment) = match target.find(['#', '^']) {
                Some(i) => (target[..i].trim(), Some(target[i..].trim_start_matches('#'))),
                None => (target.trim(), None),
            };
            let section = if name.is_empty() {
                Some(index)
            } else {
                crate::links::resolve(name, from, paths).and_then(|p| section_of(notes, p))
            };
            match section.and_then(|s| locate(notes, s, fragment)) {
                Some((anchor, title)) => {
                    let label = alias.filter(|a| !a.is_empty()).map_or(title, str::to_string);
                    format!("[{}](#{anchor})", escape_label(&label))
                }
                None => c[0].to_string(),
            }
        });
        MARKDOWN
            .replace_all(&wiki, |c: &Captures| {
                let dest = &c[3];
                if !c[1].is_empty() || dest.contains("://") || dest.starts_with("mailto:") {
                    return c[0].to_string();
                }
                let (file, fragment) = dest.split_once('#').map_or((dest, None), |(f, h)| (f, Some(h)));
                let section = if file.is_empty() {
                    if internal(dest).is_some() {
                        return c[0].to_string();
                    }
                    Some(index)
                } else {
                    let file = file.replace("%20", " ");
                    crate::paths::join_relative(from, &file)
                        .filter(|p| paths.contains(p))
                        .or_else(|| crate::links::resolve(&file, from, paths).cloned())
                        .and_then(|p| section_of(notes, &p))
                };
                match section.and_then(|s| locate(notes, s, fragment)) {
                    Some((anchor, _)) => format!("[{}](#{anchor})", &c[2]),
                    None => c[0].to_string(),
                }
            })
            .into_owned()
    })
}

fn escape_label(label: &str) -> String {
    label.replace('[', "\\[").replace(']', "\\]")
}

/// Applies `f` to the text outside fenced and inline code.
pub(crate) fn outside_code(markdown: &str, mut f: impl FnMut(&str) -> String) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut fence: Option<&str> = None;
    for raw in markdown.split_inclusive('\n') {
        let marker = ["```", "~~~"].into_iter().find(|m| raw.trim_start().starts_with(m));
        match (fence, marker) {
            (None, Some(m)) => fence = Some(m),
            (Some(open), Some(m)) if open == m => fence = None,
            _ => {}
        }
        if fence.is_some() || marker.is_some() {
            out.push_str(raw);
            continue;
        }
        let mut rest = raw;
        while let Some(start) = rest.find('`') {
            let ticks = rest[start..].len() - rest[start..].trim_start_matches('`').len();
            let fence = &rest[start..start + ticks];
            let Some(end) = rest[start + ticks..].find(fence) else { break };
            out.push_str(&f(&rest[..start]));
            out.push_str(&rest[start..start + ticks + end + ticks]);
            rest = &rest[start + ticks + end + ticks..];
        }
        out.push_str(&f(rest));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(path: &str, markdown: &str) -> Section {
        Section::Note { path: path.into(), markdown: markdown.into(), shift: 0, page_break: false }
    }

    #[test]
    fn links_within_the_document_jump_and_read_as_titles() {
        let sections = [
            Section::Heading { text: "Carpeta".into(), style: None, level: 1, page_break: false },
            note("uno.md", "# Primera\n\nVer [[dos]], [[dos#Riesgos del plan]], [[dos|aquí]] y [[fuera]].\n"),
            note(
                "sub/dos.md",
                "---\ntitulo: El plan\n---\n# Dos\n\n## Riesgos del plan\n\n[atrás](../uno.md) [arriba](#dos) `[[dos]]`\n",
            ),
        ];
        let out = bodies(&sections, "es");
        assert_eq!(out[0], "");
        assert_eq!(out[1], "# Primera\n\nVer [El plan](#umd2), [Riesgos del plan](#umd2_1), [aquí](#umd2) y fuera.\n");
        assert_eq!(out[2], "# Dos\n\n## Riesgos del plan\n\n[atrás](#umd1) [arriba](#umd2_0) `[[dos]]`\n");
    }

    #[test]
    fn a_missing_heading_falls_back_to_plain_text() {
        let sections = [note("a.md", "[[b#No existe]] [[b]]\n"), note("b.md", "Sin títulos\n")];
        assert_eq!(bodies(&sections, "es")[0], "b [b](#umd1)\n");
    }

    #[test]
    fn only_rewritten_anchors_count_as_internal() {
        assert_eq!(internal("#umd3_2"), Some("umd3_2"));
        assert_eq!(internal("#umd3"), Some("umd3"));
        assert_eq!(internal("#umdx"), None);
        assert_eq!(internal("https://e.com#umd1"), None);
    }
}
