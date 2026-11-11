//! Full-text search. Plain scanning is fast enough for vaults of thousands of
//! notes and means there is no index that can go stale.

use crate::{Result, VaultFs};
use serde::Serialize;
use unicode_normalization::char::{decompose_canonical, is_combining_mark};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
    /// How well the whole note matches. Every hit of a note shares it.
    pub score: u32,
}

const MAX_TEXT: usize = 200;
/// Characters kept before the first match when the start of a line is cut.
const LEAD: usize = 24;
const NAME_SCORE: u32 = 100;
const HEADING_SCORE: u32 = 10;
const LINE_SCORE: u32 = 1;

fn fold_char(c: char, out: &mut String) {
    decompose_canonical(c, |d| {
        if !is_combining_mark(d) {
            out.extend(d.to_lowercase());
        }
    });
}

/// Lower case without accents, so that "reunion" finds "Reunión".
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        fold_char(c, &mut out);
    }
    out
}

fn is_heading(line: &str) -> bool {
    let line = line.trim_start();
    let rest = line.trim_start_matches('#');
    rest.len() < line.len() && (rest.is_empty() || rest.starts_with(' '))
}

/// The line, trimmed and cut so that the first match is near the start.
fn snippet(line: &str, terms: &[String]) -> String {
    let chars: Vec<char> = line.trim().chars().collect();
    let mut folded = String::new();
    // The character each byte of `folded` comes from.
    let mut owner = Vec::new();
    for (i, c) in chars.iter().enumerate() {
        fold_char(*c, &mut folded);
        owner.resize(folded.len(), i);
    }
    let first = terms.iter().filter_map(|t| folded.find(t.as_str())).min().map_or(0, |b| owner[b]);
    let mut start = first.saturating_sub(LEAD);
    if start > 0 {
        // Starts at a word when there is one close before.
        if let Some(space) = chars[start..first].iter().position(|c| c.is_whitespace()) {
            start += space + 1;
        }
    }
    let text: String = chars[start..].iter().take(MAX_TEXT).collect();
    if start > 0 { format!("…{text}") } else { text }
}

/// What a query asks for. Words, phrases and exclusions are folded.
#[derive(Debug, Default)]
pub struct Query {
    /// Each must be in the line, anywhere.
    pub words: Vec<String>,
    /// Each must be in the line exactly as written, between quotes.
    pub phrases: Vec<String>,
    /// A note containing any of these is left out: `-palabra`.
    pub exclude: Vec<String>,
    /// The note's path must contain one of these: `ruta:proyectos`.
    pub paths: Vec<String>,
    /// The note must have one of these tags, or one inside them: `etiqueta:cliente`.
    pub tags: Vec<String>,
    /// The note must be one of these kinds, `md` or `html`: `tipo:html`.
    pub kinds: Vec<String>,
    /// A regular expression the line must match, ignoring case: `/acta \d+/`.
    pub pattern: Option<regex::Regex>,
}

impl Query {
    /// Words and phrases to mark in what is found.
    pub fn marks(&self) -> Vec<String> {
        self.words.iter().chain(&self.phrases).cloned().collect()
    }

    /// Asks for something in the text, not only filters.
    fn has_text(&self) -> bool {
        !self.words.is_empty() || !self.phrases.is_empty() || self.pattern.is_some()
    }

    fn is_empty(&self) -> bool {
        !self.has_text() && self.paths.is_empty() && self.tags.is_empty() && self.kinds.is_empty()
    }

    fn matches_text(&self, text: &str) -> bool {
        let folded = fold(text);
        self.words.iter().chain(&self.phrases).all(|t| folded.contains(t.as_str()))
            && self.pattern.as_ref().is_none_or(|p| p.is_match(text))
    }

    fn wants_path(&self, path: &str) -> bool {
        let folded = fold(path);
        let kind = if folded.ends_with(".html") || folded.ends_with(".htm") { "html" } else { "md" };
        (self.paths.is_empty() || self.paths.iter().any(|p| folded.contains(p.as_str())))
            && (self.kinds.is_empty() || self.kinds.iter().any(|k| k == kind))
    }

    fn wants_note(&self, name: &str, content: &str) -> bool {
        let folded = fold(content);
        let name = fold(name);
        !self.exclude.iter().any(|t| folded.contains(t.as_str()) || name.contains(t.as_str()))
            && (self.tags.is_empty() || {
                let found = crate::tags::tags(content);
                self.tags.iter().any(|w| found.iter().any(|t| crate::tags::tag_matches(t, w)))
            })
    }
}

/// Splits a query into pieces, keeping quoted text and expressions together:
/// `-"dos palabras"` and `/acta \d+/` are one piece each.
fn pieces(query: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut pattern = false;
    for c in query.chars() {
        if c == '/' && current.is_empty() {
            pattern = true;
            current.push(c);
        } else if c == '/' && pattern && !current.ends_with('\\') {
            pattern = false;
            current.push(c);
        } else if c == '"' && !pattern {
            quoted = !quoted;
            current.push(c);
        } else if c.is_whitespace() && !quoted && !pattern {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn unquote(text: &str) -> &str {
    let text = text.strip_prefix('"').unwrap_or(text);
    text.strip_suffix('"').unwrap_or(text)
}

/// Reads a query: words, "exact phrases", -exclusions, `ruta:`, `etiqueta:`
/// and `tipo:` filters (also `path:`, `tag:` and `type:`) and a `/regular
/// expression/`. Fails only on an expression that is not valid.
pub fn parse(query: &str) -> Result<Query> {
    let mut q = Query::default();
    for piece in pieces(query) {
        if let Some(rest) = piece.strip_prefix('-').filter(|r| !r.is_empty()) {
            q.exclude.push(fold(unquote(rest)));
            continue;
        }
        if piece.len() > 2 && piece.starts_with('/') && piece.ends_with('/') {
            let pattern = regex::RegexBuilder::new(&piece[1..piece.len() - 1])
                .case_insensitive(true)
                .size_limit(1 << 20)
                .build()
                .map_err(|e| crate::Error::Vault(format!("invalid regular expression: {e}")))?;
            q.pattern = Some(pattern);
            continue;
        }
        if let Some((key, value)) = piece.split_once(':') {
            let value = fold(unquote(value));
            let list = match fold(key).as_str() {
                "ruta" | "path" | "carpeta" | "folder" => Some(&mut q.paths),
                "etiqueta" | "tag" => Some(&mut q.tags),
                "tipo" | "type" => Some(&mut q.kinds),
                _ => None,
            };
            if let Some(list) = list {
                let value = match value.as_str() {
                    "nota" | "notas" | "note" | "markdown" => "md".to_string(),
                    "htm" => "html".to_string(),
                    _ => value.trim_start_matches('#').to_string(),
                };
                if !value.is_empty() {
                    list.push(value);
                }
                continue;
            }
        }
        if piece.starts_with('"') {
            let phrase = fold(unquote(&piece));
            if !phrase.trim().is_empty() {
                q.phrases.push(phrase);
            }
        } else {
            q.words.push(fold(&piece));
        }
    }
    Ok(q)
}

/// Finds lines that match `query`, ignoring case and accents (see [`parse`]).
/// A note whose name matches reports line 0, as does every note that passes
/// the filters of a query with nothing else. Notes come best first: a match
/// in the name counts most, then headings, then other lines.
pub fn search(vault: &VaultFs, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let query = parse(query)?;
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let marks = query.marks();
    let hit = |path: &str, line, text| SearchHit { path: path.to_string(), line, text, score: 0 };
    let mut found: Vec<(u32, Vec<SearchHit>)> = Vec::new();
    let listing = vault.listing()?;
    for path in listing.paths() {
        if !query.wants_path(path) {
            continue;
        }
        let name = path.rsplit_once('.').map_or(path.as_str(), |(stem, _)| stem);
        let Ok(note) = listing.read(path) else { continue };
        if !query.wants_note(name, &note.content) {
            continue;
        }
        let mut score = 0;
        let mut hits = Vec::new();
        if !query.has_text() || query.matches_text(name) {
            score += NAME_SCORE;
            hits.push(hit(path, 0, String::new()));
        }
        if query.has_text() {
            for (i, line) in note.content.lines().enumerate() {
                if hits.len() >= limit {
                    break;
                }
                if query.matches_text(line) {
                    score += if is_heading(line) { HEADING_SCORE } else { LINE_SCORE };
                    hits.push(hit(path, i + 1, snippet(line, &marks)));
                }
            }
        }
        if !hits.is_empty() {
            found.push((score, hits));
        }
    }
    // Stable, so notes that score the same keep the vault's order.
    found.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    Ok(found
        .into_iter()
        .flat_map(|(score, hits)| hits.into_iter().map(move |h| SearchHit { score, ..h }))
        .take(limit)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteMode;

    fn vault() -> (tempfile::TempDir, VaultFs) {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        (d, v)
    }

    #[test]
    fn finds_case_insensitive_and_all_terms() {
        let (_d, v) = vault();
        v.write("Reunión.md", "uno\nEl PRESUPUESTO de marzo\nmarzo solo\n", WriteMode::Create).unwrap();
        v.write("otra.md", "nada", WriteMode::Create).unwrap();
        let hits = search(&v, "presupuesto MARZO", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].path.as_str(), hits[0].line), ("Reunión.md", 2));
        let by_name = search(&v, "reunión", 10).unwrap();
        assert_eq!(by_name[0].line, 0);
        assert!(search(&v, "  ", 10).unwrap().is_empty());
    }

    #[test]
    fn ignores_accents_both_ways() {
        let (_d, v) = vault();
        v.write("Reunión.md", "Acción pendiente\n", WriteMode::Create).unwrap();
        // Decomposed accents, as some systems store them.
        v.write("b.md", "cancio\u{301}n\n", WriteMode::Create).unwrap();
        let hits = search(&v, "reunion", 10).unwrap();
        assert_eq!((hits[0].path.as_str(), hits[0].line), ("Reunión.md", 0));
        assert_eq!(search(&v, "ACCION", 10).unwrap()[0].line, 1);
        assert_eq!(search(&v, "canción", 10).unwrap()[0].path, "b.md");
        assert_eq!(fold("Ñandú ÄÖ"), "nandu ao");
    }

    #[test]
    fn the_extension_is_not_part_of_the_name() {
        let (_d, v) = vault();
        v.write("a.md", "x\n", WriteMode::Create).unwrap();
        assert!(search(&v, "md", 10).unwrap().is_empty());
    }

    #[test]
    fn ranks_names_then_headings_then_lines() {
        let (_d, v) = vault();
        v.write("a.md", "plan\nplan\n", WriteMode::Create).unwrap();
        v.write("b.md", "## Plan\n", WriteMode::Create).unwrap();
        v.write("plan.md", "nada\n", WriteMode::Create).unwrap();
        let hits = search(&v, "plan", 10).unwrap();
        let order: Vec<_> = hits.iter().map(|h| (h.path.as_str(), h.line)).collect();
        assert_eq!(order, [("plan.md", 0), ("b.md", 1), ("a.md", 1), ("a.md", 2)]);
        assert_eq!(hits[2].score, hits[3].score);
    }

    #[test]
    fn long_lines_start_near_the_match() {
        let terms = vec!["clave".to_string()];
        let long = format!("{} la palabra clave aquí", "relleno ".repeat(30));
        let text = snippet(&long, &terms);
        assert!(text.starts_with('…'), "{text}");
        assert!(text.chars().position(|c| c == 'c').unwrap() <= LEAD + 1, "{text}");
        assert!(text.contains("palabra clave"), "{text}");
        assert_eq!(snippet("  clave al principio ", &terms), "clave al principio");
    }

    fn found(v: &VaultFs, query: &str) -> Vec<(String, usize)> {
        search(v, query, 50).unwrap().into_iter().map(|h| (h.path, h.line)).collect()
    }

    #[test]
    fn phrases_must_be_exact_and_words_can_be_left_out() {
        let (_d, v) = vault();
        v.write("a.md", "plan de marzo\nmarzo y plan\n", WriteMode::Create).unwrap();
        v.write("b.md", "plan de marzo borrador\n", WriteMode::Create).unwrap();
        assert_eq!(found(&v, "\"plan de marzo\""), [("a.md".into(), 1), ("b.md".into(), 1)]);
        assert_eq!(found(&v, "\"plan de marzo\" -borrador"), [("a.md".into(), 1)]);
        assert_eq!(found(&v, "marzo -\"y plan\""), [("b.md".into(), 1)]);
    }

    #[test]
    fn filters_by_path_tag_and_kind() {
        let (_d, v) = vault();
        v.write("proyectos/web.md", "acta #cliente/acme\n", WriteMode::Create).unwrap();
        v.write("personal/diario.md", "acta\n", WriteMode::Create).unwrap();
        v.write("proyectos/informe.html", "<p>acta</p>\n", WriteMode::Create).unwrap();
        assert_eq!(found(&v, "acta ruta:proyectos tipo:nota"), [("proyectos/web.md".into(), 1)]);
        assert_eq!(found(&v, "acta tipo:html"), [("proyectos/informe.html".into(), 1)]);
        // Filters alone list the notes that pass them.
        assert_eq!(found(&v, "etiqueta:cliente"), [("proyectos/web.md".into(), 0)]);
        assert_eq!(found(&v, "tag:#Cliente/acme ruta:Proyectos"), [("proyectos/web.md".into(), 0)]);
    }

    #[test]
    fn regular_expressions_match_lines_and_bad_ones_fail() {
        let (_d, v) = vault();
        v.write("a.md", "Acta 12\nacta sin número\n", WriteMode::Create).unwrap();
        assert_eq!(found(&v, r"/acta \d+/"), [("a.md".into(), 1)]);
        assert!(search(&v, "/(sin cerrar/", 10).is_err());
        // A lone slash is just a word.
        assert!(search(&v, "/", 10).is_ok());
    }

    #[test]
    fn a_word_with_a_colon_is_still_a_word() {
        let q = parse("hora:10 ruta: tipo:x").unwrap();
        assert_eq!(q.words, ["hora:10"]);
        assert!(q.paths.is_empty());
        assert_eq!(q.kinds, ["x"]);
    }

    #[test]
    fn respects_limit() {
        let (_d, v) = vault();
        v.write("a.md", "x\nx\nx\nx\n", WriteMode::Create).unwrap();
        assert_eq!(search(&v, "x", 2).unwrap().len(), 2);
    }
}
