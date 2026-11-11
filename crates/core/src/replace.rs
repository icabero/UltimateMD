//! Replacing text in many notes at once. A plan shows each line before and
//! after; applying it changes only the lines chosen, worked out again from
//! the note as it is then, so nothing written in between is lost.

use crate::{Error, Result};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Replace {
    pub find: String,
    pub with: String,
    /// Upper and lower case count as different.
    #[serde(default)]
    pub match_case: bool,
    /// Only whole words: `plan` does not change `planta`.
    #[serde(default)]
    pub whole_word: bool,
    /// `find` is a regular expression and `with` may use `$1`.
    #[serde(default)]
    pub regex: bool,
}

/// One line that changes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineChange {
    /// Counting from 1.
    pub line: usize,
    pub before: String,
    pub after: String,
}

impl Replace {
    fn pattern(&self) -> Result<Regex> {
        if self.find.is_empty() {
            return Err(Error::Vault("nothing to find".into()));
        }
        let source = if self.regex { self.find.clone() } else { regex::escape(&self.find) };
        let source = if self.whole_word { format!(r"\b(?:{source})\b") } else { source };
        RegexBuilder::new(&source)
            .case_insensitive(!self.match_case)
            .size_limit(1 << 20)
            .build()
            .map_err(|e| Error::Vault(format!("invalid regular expression: {e}")))
    }

    /// The lines of `content` that would change.
    pub fn changes(&self, content: &str) -> Result<Vec<LineChange>> {
        let pattern = self.pattern()?;
        Ok(content
            .lines()
            .enumerate()
            .filter(|(_, line)| pattern.is_match(line))
            .map(|(i, line)| LineChange {
                line: i + 1,
                before: line.to_string(),
                after: self.apply_line(&pattern, line),
            })
            .filter(|c| c.before != c.after)
            .collect())
    }

    fn apply_line(&self, pattern: &Regex, line: &str) -> String {
        if self.regex {
            pattern.replace_all(line, self.with.as_str())
        } else {
            pattern.replace_all(line, NoExpand(&self.with))
        }
        .into_owned()
    }

    /// The note with the chosen lines replaced, and how many lines changed.
    /// `lines` None changes every line that matches.
    pub fn apply(&self, content: &str, lines: Option<&[usize]>) -> Result<(String, usize)> {
        let pattern = self.pattern()?;
        let mut out = String::with_capacity(content.len());
        let mut changed = 0;
        for (i, piece) in content.split_inclusive('\n').enumerate() {
            let (line, end) = match piece.strip_suffix("\r\n").or_else(|| piece.strip_suffix('\n')) {
                Some(line) => (line, &piece[line.len()..]),
                None => (piece, ""),
            };
            if lines.is_none_or(|l| l.contains(&(i + 1))) && pattern.is_match(line) {
                let after = self.apply_line(&pattern, line);
                if after != line {
                    changed += 1;
                }
                out.push_str(&after);
            } else {
                out.push_str(line);
            }
            out.push_str(end);
        }
        Ok((out, changed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(find: &str, with: &str) -> Replace {
        Replace { find: find.into(), with: with.into(), match_case: false, whole_word: false, regex: false }
    }

    #[test]
    fn shows_each_line_before_and_after() {
        let changes = r("cliente", "socio").changes("El Cliente\nnada\ncliente y cliente\n").unwrap();
        assert_eq!(changes.len(), 2);
        assert_eq!((changes[0].line, changes[0].after.as_str()), (1, "El socio"));
        assert_eq!(changes[1].after, "socio y socio");
    }

    #[test]
    fn case_whole_words_and_expressions() {
        let exact = Replace { match_case: true, ..r("Plan", "Proyecto") };
        assert_eq!(exact.apply("Plan y plan\n", None).unwrap().0, "Proyecto y plan\n");
        let whole = Replace { whole_word: true, ..r("plan", "idea") };
        assert_eq!(whole.apply("plan, planta\n", None).unwrap().0, "idea, planta\n");
        let expr = Replace { regex: true, ..r(r"acta (\d+)", "Acta nº $1") };
        assert_eq!(expr.apply("acta 7\n", None).unwrap().0, "Acta nº 7\n");
        // Without expressions, $ is just a character.
        assert_eq!(r("precio", "$1 euros").apply("precio\n", None).unwrap().0, "$1 euros\n");
        assert!(Replace { regex: true, ..r("(", "x") }.changes("a").is_err());
        assert!(r("", "x").changes("a").is_err());
    }

    #[test]
    fn only_the_chosen_lines_change_and_line_ends_stay() {
        let (text, n) = r("a", "b").apply("a\r\na\r\na", Some(&[1, 3])).unwrap();
        assert_eq!((text.as_str(), n), ("b\r\na\r\nb", 2));
    }
}
