//! Obsidian's `%%comments%%` and `==highlights==` for the exporters. Comments
//! are for whoever writes, so they never reach a document; a highlight keeps
//! its text. Code, fenced or inline, is left as written.

/// Removes comments and the `==` around highlights, outside code.
pub fn strip(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut fence: Option<&str> = None;
    let mut in_comment = false;
    for raw in markdown.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\n', '\r']);
        let ending = &raw[line.len()..];
        if !in_comment {
            let marker = ["```", "~~~"].into_iter().find(|m| line.trim_start().starts_with(m));
            match (fence, marker) {
                (None, Some(m)) => {
                    fence = Some(m);
                    out.push_str(raw);
                    continue;
                }
                (Some(open), Some(m)) if open == m => {
                    fence = None;
                    out.push_str(raw);
                    continue;
                }
                (Some(_), _) => {
                    out.push_str(raw);
                    continue;
                }
                _ => {}
            }
        }
        let (text, open) = strip_line(line, in_comment);
        // A line that held only a comment goes away whole.
        if text.trim().is_empty() && (in_comment || open || line.trim_start().starts_with("%%")) {
            in_comment = open;
            continue;
        }
        in_comment = open;
        out.push_str(&text);
        out.push_str(ending);
    }
    out
}

/// One line, starting inside a comment or not. Returns the text and whether a
/// comment is still open at its end.
fn strip_line(line: &str, mut in_comment: bool) -> (String, bool) {
    let mut out = String::new();
    let mut rest = line;
    while !rest.is_empty() {
        if in_comment {
            match rest.find("%%") {
                Some(i) => {
                    rest = &rest[i + 2..];
                    in_comment = false;
                }
                None => return (out, true),
            }
            continue;
        }
        if let Some(code) = rest.strip_prefix('`') {
            let ticks = 1 + code.len() - code.trim_start_matches('`').len();
            let fence = &rest[..ticks];
            if let Some(end) = rest[ticks..].find(fence) {
                out.push_str(&rest[..ticks + end + ticks]);
                rest = &rest[ticks + end + ticks..];
            } else {
                out.push_str(rest);
                rest = "";
            }
        } else if let Some(after) = rest.strip_prefix("%%") {
            // A comment on its own line may close on a later one.
            if after.contains("%%") || out.trim().is_empty() {
                rest = after;
                in_comment = true;
            } else {
                out.push_str("%%");
                rest = after;
            }
        } else if let Some(inner) = highlight(rest) {
            out.push_str(inner);
            rest = &rest[inner.len() + 4..];
        } else {
            let next = rest.char_indices().nth(1).map_or(rest.len(), |(i, _)| i);
            out.push_str(&rest[..next]);
            rest = &rest[next..];
        }
    }
    (out, in_comment)
}

/// `==text==` at the start of `s`, with no space just inside the marks.
fn highlight(s: &str) -> Option<&str> {
    let after = s.strip_prefix("==")?;
    let inner = &after[..after.find("==")?];
    let trimmed = inner.trim();
    (!trimmed.is_empty() && trimmed.len() == inner.len()).then_some(inner)
}

#[cfg(test)]
mod tests {
    use super::strip;

    #[test]
    fn comments_go_and_highlights_keep_their_text() {
        assert_eq!(strip("Un ==texto== y %%oculto%% fin.\n"), "Un texto y  fin.\n");
        assert_eq!(strip("Antes\n\n%%\nsecreto\n%%\n\nDespués\n"), "Antes\n\n\nDespués\n");
        assert_eq!(strip("%% una sola %%\nSigue\n"), "Sigue\n");
        assert_eq!(strip("2 == 2 y ==  no ==\n"), "2 == 2 y ==  no ==\n");
    }

    #[test]
    fn code_is_left_alone() {
        let text = "`==a== %%b%%`\n```\n%%\n==c==\n```\nfin ==d==\n";
        assert_eq!(strip(text), "`==a== %%b%%`\n```\n%%\n==c==\n```\nfin d\n");
    }

    #[test]
    fn a_stray_mark_mid_line_stays() {
        assert_eq!(strip("50%% de descuento\n"), "50%% de descuento\n");
    }
}
