//! Formulas in notes (`$x^2$` and `$$ ... $$`) for the Word and PDF writers.
//!
//! LaTeX is read into a small tree of what it means, from which Word's own
//! equation format (OMML) and Typst's math are written. The common syntax is
//! covered: fractions, scripts, roots, Greek letters, big operators with
//! limits, delimiters, matrices, cases, accents, `\text` and font commands.
//! A command the converters do not know stays in the formula as plain text,
//! and a formula that cannot be read at all gives `None`, so the writers put
//! it in as written: an export never fails because of a formula.

use pulldown_cmark::{CowStr, Event, Parser};

#[cfg(test)]
mod tests;

/// The longest formula converted; anything longer is left as written.
const MAX_LENGTH: usize = 6000;
/// How deep braces and environments may nest.
const MAX_DEPTH: usize = 40;

/// The events of a note, with a formula that is really a price turned back into text.
///
/// The Markdown parser already refuses `$` before a space and after one. The
/// usual rule that a closing `$` is not followed by a digit is applied here, as
/// the preview does.
pub fn events(body: &str) -> impl Iterator<Item = Event<'_>> {
    Parser::new_ext(body, crate::export_links::OPTIONS).into_offset_iter().map(move |(event, range)| match event {
        Event::InlineMath(_) if body[range.end..].starts_with(|c: char| c.is_ascii_digit()) => {
            Event::Text(CowStr::Borrowed(&body[range]))
        }
        event => event,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    Row(Vec<Node>),
    /// A letter, written in italics.
    Ident(String),
    Number(String),
    /// An operator, relation, punctuation or symbol.
    Sym(String),
    /// A function name such as `sin`, upright. `limits`: its subscript goes below it.
    Func {
        name: String,
        limits: bool,
    },
    Text(String),
    /// What could not be understood, kept as written.
    Raw(String),
    Space(Space),
    Frac {
        num: Box<Node>,
        den: Box<Node>,
        bar: bool,
    },
    Sqrt {
        degree: Option<Box<Node>>,
        body: Box<Node>,
    },
    Script {
        base: Box<Node>,
        sub: Option<Box<Node>>,
        sup: Option<Box<Node>>,
    },
    /// A sum, product or integral sign with its limits.
    Nary {
        op: char,
        sub: Option<Box<Node>>,
        sup: Option<Box<Node>>,
    },
    Delim {
        open: Option<String>,
        close: Option<String>,
        body: Box<Node>,
    },
    Matrix {
        open: Option<String>,
        close: Option<String>,
        rows: Vec<Vec<Node>>,
    },
    Cases(Vec<Vec<Node>>),
    /// Rows of an aligned set of equations; `&` stays in the cells as a symbol.
    Aligned(Vec<Vec<Node>>),
    Accent {
        kind: Accent,
        body: Box<Node>,
    },
    Style {
        style: Style,
        body: Box<Node>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Space {
    Thin,
    Medium,
    Thick,
    Quad,
    QuadQuad,
    Plain,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Accent {
    Hat,
    Tilde,
    Vec,
    Dot,
    DoubleDot,
    Bar,
    Overline,
    Underline,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Style {
    Bold,
    Upright,
    Italic,
    DoubleStruck,
    Script,
    Fraktur,
    Sans,
    Mono,
}

/// What people write, from a school exercise to a paper.
#[doc(hidden)]
pub const SAMPLES: &[&str] = &[
    "x^2",
    "x_i^2 + y_{i+1}",
    r"\frac{a+b}{c}",
    r"\dfrac{1}{1+\frac{1}{x}}",
    r"\sqrt{x}",
    r"\sqrt[3]{x^2+1}",
    r"\alpha + \beta = \gamma",
    r"\Gamma \Delta \Omega \pi \varphi",
    r"\sum_{i=1}^{n} i^2 = \frac{n(n+1)(2n+1)}{6}",
    r"\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}",
    r"\prod_{k=1}^n k",
    r"\lim_{x \to 0} \frac{\sin x}{x} = 1",
    r"\left( \frac{a}{b} \right)^2",
    r"\left[ x \right) \left\{ y \right\} \left| z \right|",
    r"\left\langle u, v \right\rangle",
    r"\text{si } x > 0 \text{ entonces } f(x) = 1",
    r"\mathbf{v} \cdot \mathbf{w} = |v||w|\cos\theta",
    r"\mathbb{R}^n \subset \mathbb{C}",
    r"\mathcal{L}\{f\}",
    r"\hat{x} \bar{y} \vec{v} \dot{a} \ddot{a} \tilde{n} \overline{AB} \underline{x}",
    r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
    r"\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}",
    r"\begin{vmatrix} a & b \\ c & d \end{vmatrix} = ad - bc",
    r"f(x) = \begin{cases} 1 & x > 0 \\ 0 & \text{en otro caso} \end{cases}",
    r"\begin{aligned} a &= b + c \\ &= d \end{aligned}",
    r"a = b \\ c = d",
    r"\binom{n}{k} = \frac{n!}{k!(n-k)!}",
    r"x \leq y \neq z \geq w \approx v \equiv u",
    r"A \cup B \cap C \in D \notin E \forall x \exists y",
    r"\partial f / \partial x",
    r"a \quad b \, c \; d \! e",
    r"\operatorname{sen} x + \log_2 n + \ln x",
    r"f'(x) + g''(x)",
    r"\overbrace{a+b}^{n} \unknowncommand{x}",
    r"x \to \infty \Rightarrow y \leftarrow z",
    r"\lbrace 1, 2 \rbrace [0, 1) (a; b) a|b a/b",
    r"{}^{14}_{6}C",
    r"\sqrt{\frac{a}{b}}",
    r"e^{i\pi} + 1 = 0",
    r"\sum_{i} x_i",
    r"3.14 \times 10^{8}",
    r"\# \$ \% \& \_",
    r"\displaystyle \lim_{n\to\infty} \left(1+\frac1n\right)^n = e",
];

// ---------------------------------------------------------------------------
// Reading LaTeX

type Parsed<T> = Result<T, ()>;

#[derive(Clone, Copy)]
struct Mode {
    brace: bool,
    delim: bool,
    table: bool,
}

#[derive(Debug, PartialEq)]
enum Stop {
    Eof,
    Brace,
    Right(Option<String>),
    Amp,
    Newline,
    End(String),
}

struct Reader {
    chars: Vec<char>,
    pos: usize,
    depth: usize,
}

fn greek(name: &str) -> Option<&'static str> {
    Some(match name {
        "alpha" => "α",
        "beta" => "β",
        "gamma" => "γ",
        "delta" => "δ",
        "epsilon" => "ϵ",
        "varepsilon" => "ε",
        "zeta" => "ζ",
        "eta" => "η",
        "theta" => "θ",
        "vartheta" => "ϑ",
        "iota" => "ι",
        "kappa" => "κ",
        "lambda" => "λ",
        "mu" => "μ",
        "nu" => "ν",
        "xi" => "ξ",
        "omicron" => "ο",
        "pi" => "π",
        "varpi" => "ϖ",
        "rho" => "ρ",
        "varrho" => "ϱ",
        "sigma" => "σ",
        "varsigma" => "ς",
        "tau" => "τ",
        "upsilon" => "υ",
        "phi" => "ϕ",
        "varphi" => "φ",
        "chi" => "χ",
        "psi" => "ψ",
        "omega" => "ω",
        "ell" => "ℓ",
        "hbar" => "ℏ",
        "imath" => "ı",
        "jmath" => "ȷ",
        "aleph" => "ℵ",
        _ => return None,
    })
}

fn symbol(name: &str) -> Option<&'static str> {
    Some(match name {
        "Gamma" => "Γ",
        "Delta" => "Δ",
        "Theta" => "Θ",
        "Lambda" => "Λ",
        "Xi" => "Ξ",
        "Pi" => "Π",
        "Sigma" => "Σ",
        "Upsilon" => "Υ",
        "Phi" => "Φ",
        "Psi" => "Ψ",
        "Omega" => "Ω",
        "cdot" => "⋅",
        "times" => "×",
        "div" => "÷",
        "pm" => "±",
        "mp" => "∓",
        "ast" | "star" => "∗",
        "circ" => "∘",
        "bullet" => "•",
        "oplus" => "⊕",
        "ominus" => "⊖",
        "otimes" => "⊗",
        "odot" => "⊙",
        "cup" => "∪",
        "cap" => "∩",
        "setminus" => "∖",
        "wedge" | "land" => "∧",
        "vee" | "lor" => "∨",
        "neg" | "lnot" => "¬",
        "leq" | "le" => "≤",
        "geq" | "ge" => "≥",
        "ll" => "≪",
        "gg" => "≫",
        "neq" | "ne" => "≠",
        "approx" => "≈",
        "equiv" => "≡",
        "sim" => "∼",
        "simeq" => "≃",
        "cong" => "≅",
        "propto" => "∝",
        "perp" => "⟂",
        "parallel" => "∥",
        "mid" => "∣",
        "in" => "∈",
        "notin" => "∉",
        "ni" => "∋",
        "subset" => "⊂",
        "supset" => "⊃",
        "subseteq" => "⊆",
        "supseteq" => "⊇",
        "emptyset" | "varnothing" => "∅",
        "forall" => "∀",
        "exists" => "∃",
        "nexists" => "∄",
        "infty" => "∞",
        "partial" => "∂",
        "nabla" => "∇",
        "angle" => "∠",
        "degree" => "°",
        "prime" => "′",
        "to" | "rightarrow" => "→",
        "leftarrow" | "gets" => "←",
        "leftrightarrow" => "↔",
        "Rightarrow" | "implies" => "⇒",
        "Leftarrow" => "⇐",
        "Leftrightarrow" | "iff" => "⇔",
        "mapsto" => "↦",
        "uparrow" => "↑",
        "downarrow" => "↓",
        "ldots" | "dots" | "dotsc" | "dotsb" => "…",
        "cdots" => "⋯",
        "vdots" => "⋮",
        "ddots" => "⋱",
        "Re" => "ℜ",
        "Im" => "ℑ",
        "wp" => "℘",
        "dagger" => "†",
        "ddagger" => "‡",
        "triangle" => "△",
        "square" => "□",
        "backslash" => "∖",
        "lt" => "<",
        "gt" => ">",
        "colon" => ":",
        "lbrace" => "{",
        "rbrace" => "}",
        "langle" => "⟨",
        "rangle" => "⟩",
        "lfloor" => "⌊",
        "rfloor" => "⌋",
        "lceil" => "⌈",
        "rceil" => "⌉",
        "vert" | "lvert" | "rvert" => "|",
        "Vert" | "lVert" | "rVert" => "‖",
        "%" => "%",
        "$" => "$",
        "#" => "#",
        "&" => "&",
        "_" => "_",
        "{" => "{",
        "}" => "}",
        "|" => "‖",
        _ => return None,
    })
}

fn nary(name: &str) -> Option<char> {
    Some(match name {
        "sum" => '∑',
        "prod" => '∏',
        "coprod" => '∐',
        "int" => '∫',
        "iint" => '∬',
        "iiint" => '∭',
        "oint" => '∮',
        "bigcup" => '⋃',
        "bigcap" => '⋂',
        "bigvee" => '⋁',
        "bigwedge" => '⋀',
        "bigoplus" => '⨁',
        "bigotimes" => '⨂',
        _ => return None,
    })
}

/// Function names, and whether their subscript goes below them.
fn function(name: &str) -> Option<bool> {
    Some(match name {
        "lim" | "limsup" | "liminf" | "max" | "min" | "sup" | "inf" | "det" | "gcd" | "Pr" | "argmax" | "argmin" => {
            true
        }
        "sin" | "cos" | "tan" | "cot" | "sec" | "csc" | "arcsin" | "arccos" | "arctan" | "sinh" | "cosh" | "tanh"
        | "coth" | "log" | "ln" | "lg" | "exp" | "deg" | "dim" | "ker" | "arg" | "hom" | "mod" | "bmod" | "Tr"
        | "tr" => false,
        _ => return None,
    })
}

fn accent(name: &str) -> Option<Accent> {
    Some(match name {
        "hat" | "widehat" => Accent::Hat,
        "tilde" | "widetilde" => Accent::Tilde,
        "vec" => Accent::Vec,
        "dot" => Accent::Dot,
        "ddot" => Accent::DoubleDot,
        "bar" => Accent::Bar,
        "overline" => Accent::Overline,
        "underline" => Accent::Underline,
        _ => return None,
    })
}

fn style(name: &str) -> Option<Style> {
    Some(match name {
        "mathbf" | "boldsymbol" | "bm" | "textbf" | "mathbfit" => Style::Bold,
        "mathrm" | "textrm" | "mathup" => Style::Upright,
        "mathit" | "textit" => Style::Italic,
        "mathbb" => Style::DoubleStruck,
        "mathcal" | "mathscr" => Style::Script,
        "mathfrak" => Style::Fraktur,
        "mathsf" | "textsf" => Style::Sans,
        "mathtt" | "texttt" => Style::Mono,
        _ => return None,
    })
}

fn space(name: &str) -> Option<Space> {
    Some(match name {
        "," | "thinspace" => Space::Thin,
        ":" | ">" | "medspace" => Space::Medium,
        ";" | "thickspace" => Space::Thick,
        "quad" => Space::Quad,
        "qquad" => Space::QuadQuad,
        " " => Space::Plain,
        _ => return None,
    })
}

/// The rows of an environment, and how it is drawn.
enum Environment {
    Matrix(Option<&'static str>, Option<&'static str>),
    Cases,
    Aligned,
}

fn environment(name: &str) -> Option<Environment> {
    Some(match name {
        "matrix" | "smallmatrix" | "array" | "subarray" => Environment::Matrix(None, None),
        "pmatrix" => Environment::Matrix(Some("("), Some(")")),
        "bmatrix" => Environment::Matrix(Some("["), Some("]")),
        "Bmatrix" => Environment::Matrix(Some("{"), Some("}")),
        "vmatrix" => Environment::Matrix(Some("|"), Some("|")),
        "Vmatrix" => Environment::Matrix(Some("‖"), Some("‖")),
        "cases" => Environment::Cases,
        "aligned" | "align" | "align*" | "alignat" | "split" | "gather" | "gathered" | "gather*" | "eqnarray"
        | "eqnarray*" | "multline" | "multline*" => Environment::Aligned,
        _ => return None,
    })
}

impl Reader {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn skip_space(&mut self) {
        while self.peek().is_some_and(char::is_whitespace) {
            self.pos += 1;
        }
    }

    /// The name after a backslash: a run of letters, or one other character.
    fn command_name(&mut self) -> Parsed<String> {
        let first = self.peek().ok_or(())?;
        self.pos += 1;
        if !first.is_ascii_alphabetic() {
            return Ok(first.to_string());
        }
        let mut name = first.to_string();
        while let Some(c) = self.peek().filter(char::is_ascii_alphabetic) {
            name.push(c);
            self.pos += 1;
        }
        // A star belongs to the name of environments (`align*`); `\begin` reads it itself.
        Ok(name)
    }

    /// The text of `{...}`, braces inside kept, as written.
    fn raw_group(&mut self) -> Parsed<String> {
        self.skip_space();
        if self.peek() != Some('{') {
            return Err(());
        }
        self.pos += 1;
        let mut depth = 1;
        let mut text = String::new();
        while let Some(c) = self.peek() {
            self.pos += 1;
            match c {
                '\\' => {
                    text.push(c);
                    if let Some(next) = self.peek() {
                        text.push(next);
                        self.pos += 1;
                    }
                    continue;
                }
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Ok(text);
                    }
                }
                _ => {}
            }
            text.push(c);
        }
        Err(())
    }

    /// A delimiter after `\left`, `\right` or `\big`: None for `.`.
    fn delimiter(&mut self) -> Parsed<Option<String>> {
        self.skip_space();
        let c = self.peek().ok_or(())?;
        self.pos += 1;
        Ok(match c {
            '.' => None,
            '(' | ')' | '[' | ']' | '<' | '>' | '/' | '|' => Some(c.to_string()),
            '\\' => {
                let name = self.command_name()?;
                match name.as_str() {
                    "{" | "lbrace" => Some("{".into()),
                    "}" | "rbrace" => Some("}".into()),
                    "|" | "Vert" | "lVert" | "rVert" => Some("‖".into()),
                    "vert" | "lvert" | "rvert" => Some("|".into()),
                    "langle" => Some("⟨".into()),
                    "rangle" => Some("⟩".into()),
                    "lfloor" => Some("⌊".into()),
                    "rfloor" => Some("⌋".into()),
                    "lceil" => Some("⌈".into()),
                    "rceil" => Some("⌉".into()),
                    "backslash" => Some("\\".into()),
                    _ => return Err(()),
                }
            }
            _ => return Err(()),
        })
    }

    /// Items until something ends the row.
    fn row(&mut self, mode: Mode) -> Parsed<(Vec<Node>, Stop)> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(());
        }
        let mut items = Vec::new();
        let stop = loop {
            self.skip_space();
            let Some(c) = self.peek() else { break Stop::Eof };
            match c {
                '}' => {
                    if !mode.brace {
                        return Err(());
                    }
                    self.pos += 1;
                    break Stop::Brace;
                }
                '&' if mode.table => {
                    self.pos += 1;
                    break Stop::Amp;
                }
                '\\' => {
                    let before = self.pos;
                    self.pos += 1;
                    let name = self.command_name()?;
                    match name.as_str() {
                        "\\" if mode.table => break Stop::Newline,
                        "right" => {
                            if !mode.delim {
                                return Err(());
                            }
                            break Stop::Right(self.delimiter()?);
                        }
                        "end" => {
                            let which = self.raw_group()?;
                            if !mode.table {
                                return Err(());
                            }
                            break Stop::End(which);
                        }
                        _ => {
                            self.pos = before;
                        }
                    }
                }
                _ => {}
            }
            if let Some(node) = self.item()? {
                items.push(node);
            }
        };
        self.depth -= 1;
        Ok((items, stop))
    }

    /// One thing with the scripts that follow it.
    fn item(&mut self) -> Parsed<Option<Node>> {
        let Some(mut node) = self.primary()? else { return Ok(None) };
        let (mut sub, mut sup) = (None, None);
        loop {
            self.skip_space();
            match self.peek() {
                Some('^') if sup.is_none() => {
                    self.pos += 1;
                    sup = Some(Box::new(self.argument()?));
                }
                Some('_') if sub.is_none() => {
                    self.pos += 1;
                    sub = Some(Box::new(self.argument()?));
                }
                Some('\'') => {
                    self.pos += 1;
                    let mut primes = String::from("′");
                    while self.peek() == Some('\'') {
                        self.pos += 1;
                        primes.push('′');
                    }
                    sup = Some(Box::new(match sup.take() {
                        Some(old) => Node::Row(vec![Node::Sym(primes), *old]),
                        None => Node::Sym(primes),
                    }));
                }
                _ => break,
            }
        }
        if sub.is_some() || sup.is_some() {
            node = match node {
                Node::Nary { op, .. } => Node::Nary { op, sub, sup },
                base => Node::Script { base: Box::new(base), sub, sup },
            };
        }
        Ok(Some(node))
    }

    /// What a script or a `\frac` takes: a group, or one symbol.
    fn argument(&mut self) -> Parsed<Node> {
        self.skip_space();
        match self.peek() {
            Some('{') => self.group(),
            Some(c) if c.is_ascii_digit() => {
                self.pos += 1;
                Ok(Node::Number(c.to_string()))
            }
            Some('\\') => {
                self.pos += 1;
                Ok(self.command()?.unwrap_or(Node::Row(Vec::new())))
            }
            Some('^' | '_' | '}') | None => Err(()),
            Some(_) => Ok(self.primary()?.unwrap_or(Node::Row(Vec::new()))),
        }
    }

    fn group(&mut self) -> Parsed<Node> {
        self.pos += 1;
        let (items, stop) = self.row(Mode { brace: true, delim: false, table: false })?;
        if stop != Stop::Brace {
            return Err(());
        }
        Ok(Node::Row(items))
    }

    fn primary(&mut self) -> Parsed<Option<Node>> {
        self.skip_space();
        let Some(c) = self.peek() else { return Ok(None) };
        self.pos += 1;
        Ok(Some(match c {
            '{' => {
                self.pos -= 1;
                self.group()?
            }
            '\\' => return self.command(),
            '^' | '_' => return Err(()),
            c if c.is_ascii_digit() => {
                let mut number = c.to_string();
                while let Some(d) = self.peek().filter(char::is_ascii_digit) {
                    number.push(d);
                    self.pos += 1;
                }
                if self.peek() == Some('.') && self.chars.get(self.pos + 1).is_some_and(char::is_ascii_digit) {
                    number.push('.');
                    self.pos += 1;
                    while let Some(d) = self.peek().filter(char::is_ascii_digit) {
                        number.push(d);
                        self.pos += 1;
                    }
                }
                Node::Number(number)
            }
            c if c.is_alphabetic() => Node::Ident(c.to_string()),
            '-' => Node::Sym("−".into()),
            '*' => Node::Sym("∗".into()),
            '~' => Node::Space(Space::Plain),
            '\'' => Node::Sym("′".into()),
            c => Node::Sym(c.to_string()),
        }))
    }

    /// A command, the backslash already read.
    fn command(&mut self) -> Parsed<Option<Node>> {
        let name = self.command_name()?;
        let name = name.as_str();
        if let Some(letter) = greek(name) {
            return Ok(Some(Node::Ident(letter.into())));
        }
        if let Some(sym) = symbol(name) {
            return Ok(Some(Node::Sym(sym.into())));
        }
        if let Some(op) = nary(name) {
            return Ok(Some(Node::Nary { op, sub: None, sup: None }));
        }
        if let Some(limits) = function(name) {
            return Ok(Some(Node::Func { name: name.into(), limits }));
        }
        if let Some(kind) = space(name) {
            return Ok(Some(Node::Space(kind)));
        }
        if let Some(kind) = accent(name) {
            return Ok(Some(Node::Accent { kind, body: Box::new(self.argument()?) }));
        }
        Ok(Some(match name {
            "frac" | "dfrac" | "tfrac" | "cfrac" => {
                Node::Frac { num: Box::new(self.argument()?), den: Box::new(self.argument()?), bar: true }
            }
            "binom" | "dbinom" | "tbinom" => {
                let (top, bottom) = (self.argument()?, self.argument()?);
                Node::Delim {
                    open: Some("(".into()),
                    close: Some(")".into()),
                    body: Box::new(Node::Frac { num: Box::new(top), den: Box::new(bottom), bar: false }),
                }
            }
            "sqrt" => {
                self.skip_space();
                let degree = if self.peek() == Some('[') {
                    self.pos += 1;
                    let start = self.pos;
                    while self.peek().is_some_and(|c| c != ']') {
                        self.pos += 1;
                    }
                    let inner: String = self.chars[start..self.pos].iter().collect();
                    self.pos += 1;
                    Some(Box::new(parse_row(&inner)?))
                } else {
                    None
                };
                Node::Sqrt { degree, body: Box::new(self.argument()?) }
            }
            "text" | "mbox" | "hbox" | "textnormal" => Node::Text(plain_text(&self.raw_group()?)),
            "operatorname" | "operatorname*" | "mathop" => {
                Node::Func { name: plain_text(&self.raw_group()?), limits: false }
            }
            "left" => {
                let open = self.delimiter()?;
                let (items, stop) = self.row(Mode { brace: false, delim: true, table: false })?;
                let Stop::Right(close) = stop else { return Err(()) };
                Node::Delim { open, close, body: Box::new(Node::Row(items)) }
            }
            "big" | "Big" | "bigg" | "Bigg" | "bigl" | "bigr" | "Bigl" | "Bigr" | "biggl" | "biggr" | "Biggl"
            | "Biggr" | "middle" => Node::Sym(self.delimiter()?.unwrap_or_default()),
            "begin" => self.environment()?,
            "!" | "displaystyle" | "textstyle" | "scriptstyle" | "scriptscriptstyle" | "limits" | "nolimits"
            | "relax" | "nonumber" | "notag" | "protect" => return Ok(None),
            "label" => {
                self.raw_group()?;
                return Ok(None);
            }
            "mathstrut" | "strut" => return Ok(None),
            "not" => Node::Sym("̸".into()),
            "color" | "textcolor" => {
                self.raw_group()?;
                return if name == "textcolor" { Ok(Some(self.argument()?)) } else { Ok(None) };
            }
            "phantom" | "hphantom" | "vphantom" => {
                self.argument()?;
                return Ok(None);
            }
            other => {
                if let Some(kind) = style(other) {
                    return Ok(Some(Node::Style { style: kind, body: Box::new(self.argument()?) }));
                }
                Node::Raw(format!("\\{other}"))
            }
        }))
    }

    fn environment(&mut self) -> Parsed<Node> {
        let name = self.raw_group()?;
        let kind = environment(name.trim()).ok_or(())?;
        // `array` and `alignat` come with a column description.
        if matches!(name.trim(), "array" | "subarray" | "alignat") {
            self.raw_group()?;
        }
        let mut rows: Vec<Vec<Node>> = vec![Vec::new()];
        let mut cell: Vec<Node>;
        loop {
            let (items, stop) = self.row(Mode { brace: false, delim: false, table: true })?;
            cell = items;
            let last = rows.last_mut().ok_or(())?;
            last.push(Node::Row(std::mem::take(&mut cell)));
            match stop {
                Stop::Amp => {}
                Stop::Newline => rows.push(Vec::new()),
                Stop::End(end) if end.trim() == name.trim() => break,
                _ => return Err(()),
            }
        }
        // A row left empty by a final `\\` is not a row.
        if rows.len() > 1 && rows.last().is_some_and(|r| r.iter().all(|c| matches!(c, Node::Row(v) if v.is_empty()))) {
            rows.pop();
        }
        Ok(match kind {
            Environment::Matrix(open, close) => {
                let width = rows.iter().map(Vec::len).max().unwrap_or(0);
                for row in &mut rows {
                    row.resize(width, Node::Row(Vec::new()));
                }
                Node::Matrix { open: open.map(String::from), close: close.map(String::from), rows }
            }
            Environment::Cases => Node::Cases(rows),
            Environment::Aligned => Node::Aligned(join_cells(rows)),
        })
    }
}

/// Aligned rows keep their `&` as symbols between the cells.
fn join_cells(rows: Vec<Vec<Node>>) -> Vec<Vec<Node>> {
    rows.into_iter()
        .map(|cells| {
            let mut joined = Vec::new();
            for (i, cell) in cells.into_iter().enumerate() {
                if i > 0 {
                    joined.push(Node::Sym("&".into()));
                }
                joined.push(cell);
            }
            joined
        })
        .collect()
}

/// The words of a `\text{...}`: its commands for dollars and braces resolved.
fn plain_text(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => match chars.next() {
                Some(' ') | None => out.push(' '),
                Some(next) if "{}$%&#_".contains(next) => out.push(next),
                Some(next) => {
                    let mut name = next.to_string();
                    while next.is_ascii_alphabetic() && chars.peek().is_some_and(char::is_ascii_alphabetic) {
                        name.push(chars.next().unwrap_or(' '));
                    }
                }
            },
            '{' | '}' => {}
            c => out.push(c),
        }
    }
    out
}

fn parse_row(latex: &str) -> Parsed<Node> {
    let mut reader = Reader { chars: latex.chars().collect(), pos: 0, depth: 0 };
    let (items, stop) = reader.row(Mode { brace: false, delim: false, table: false })?;
    if stop != Stop::Eof {
        return Err(());
    }
    Ok(Node::Row(items))
}

/// Reads a whole formula. Rows split by `\\` at the top become aligned equations.
pub fn parse(latex: &str) -> Option<Node> {
    if latex.len() > MAX_LENGTH || latex.trim().is_empty() {
        return None;
    }
    let mut reader = Reader { chars: latex.chars().collect(), pos: 0, depth: 0 };
    let mut rows: Vec<Vec<Node>> = vec![Vec::new()];
    loop {
        let (items, stop) = reader.row(Mode { brace: false, delim: false, table: true }).ok()?;
        rows.last_mut()?.push(Node::Row(items));
        match stop {
            Stop::Eof => break,
            Stop::Amp => {}
            Stop::Newline => rows.push(Vec::new()),
            _ => return None,
        }
    }
    if rows.len() == 1 && rows[0].len() == 1 {
        return rows.pop()?.pop();
    }
    Some(Node::Aligned(join_cells(rows)))
}

// ---------------------------------------------------------------------------
// Typst

fn typst_string(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' | '\r' => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// A symbol as Typst reads it: characters it uses for itself are named or escaped.
fn typst_symbol(sym: &str) -> String {
    match sym {
        "(" | ")" | "[" | "]" | "{" | "}" | "#" | "$" | "_" | "@" => format!("\\{sym}"),
        "|" => "bar.v".into(),
        "‖" => "bar.v.double".into(),
        "/" => "slash".into(),
        "\\" => "backslash".into(),
        "," => "comma".into(),
        ";" => "semi".into(),
        ":" => "colon".into(),
        "&" | "\"" | "'" | "`" | "^" | "~" => typst_string(sym),
        "" => "\"\"".into(),
        other => other.into(),
    }
}

fn typst_delimiter(delim: &Option<String>) -> String {
    match delim.as_deref() {
        None => "\"\"".into(),
        Some("⟨") => "chevron.l".into(),
        Some("⟩") => "chevron.r".into(),
        Some("⌊") => "floor.l".into(),
        Some("⌋") => "floor.r".into(),
        Some("⌈") => "ceil.l".into(),
        Some("⌉") => "ceil.r".into(),
        Some(other) => typst_symbol(other),
    }
}

fn typst_row(items: &[Node]) -> String {
    let parts: Vec<String> = items.iter().map(typst_node).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() { "\"\"".into() } else { parts.join(" ") }
}

fn typst_cells(cells: &[Node]) -> String {
    cells.iter().map(typst_node).collect::<Vec<_>>().join(", ")
}

fn typst_node(node: &Node) -> String {
    match node {
        Node::Row(items) => typst_row(items),
        Node::Ident(s) | Node::Number(s) => s.clone(),
        Node::Sym(s) => typst_symbol(s),
        Node::Func { name, limits } => {
            format!("op({}{})", typst_string(name), if *limits { ", limits: #true" } else { "" })
        }
        Node::Text(s) => typst_string(s),
        Node::Raw(s) => format!("mono({})", typst_string(s)),
        Node::Space(kind) => match kind {
            Space::Thin => "thin",
            Space::Medium => "med",
            Space::Thick => "thick",
            Space::Quad => "quad",
            Space::QuadQuad => "wide",
            Space::Plain => "\" \"",
        }
        .into(),
        Node::Frac { num, den, bar: true } => format!("frac({}, {})", typst_node(num), typst_node(den)),
        Node::Frac { num, den, bar: false } => format!("binom({}, {})", typst_node(num), typst_node(den)),
        Node::Sqrt { degree: None, body } => format!("sqrt({})", typst_node(body)),
        Node::Sqrt { degree: Some(degree), body } => format!("root({}, {})", typst_node(degree), typst_node(body)),
        Node::Script { base, sub, sup } => typst_attach(&typst_node(base), sub, sup),
        Node::Nary { op, sub, sup } => typst_attach(&op.to_string(), sub, sup),
        Node::Delim { open, close, body } => {
            let (a, b) = (typst_delimiter(open), typst_delimiter(close));
            // A fraction of the binomial kind carries its own parentheses.
            if let Node::Frac { num, den, bar: false } = &**body
                && open.as_deref() == Some("(")
            {
                return format!("binom({}, {})", typst_node(num), typst_node(den));
            }
            format!("lr({a} {} {b})", typst_node(body))
        }
        Node::Matrix { open, close, rows } => {
            let delim = match (open.as_deref(), close.as_deref()) {
                (None, _) => "#none".to_string(),
                (Some("‖"), _) => typst_string("||"),
                (Some(o), _) => typst_string(o),
            };
            let _ = close;
            let body = rows.iter().map(|r| typst_cells(r)).collect::<Vec<_>>().join("; ");
            format!("mat(delim: {delim}, {body})")
        }
        Node::Cases(rows) => {
            let rows: Vec<String> =
                rows.iter().map(|cells| cells.iter().map(typst_node).collect::<Vec<_>>().join(" quad ")).collect();
            format!("cases({})", rows.join(", "))
        }
        Node::Aligned(rows) => rows.iter().map(|cells| typst_row(cells)).collect::<Vec<_>>().join(" \\ "),
        Node::Accent { kind, body } => {
            let function = match kind {
                Accent::Hat => "hat",
                Accent::Tilde => "tilde",
                Accent::Vec => "arrow",
                Accent::Dot => "dot",
                Accent::DoubleDot => "dot.double",
                Accent::Bar => "macron",
                Accent::Overline => "overline",
                Accent::Underline => "underline",
            };
            format!("{function}({})", typst_node(body))
        }
        Node::Style { style, body } => {
            let function = match style {
                Style::Bold => "bold",
                Style::Upright => "upright",
                Style::Italic => "italic",
                Style::DoubleStruck => "bb",
                Style::Script => "cal",
                Style::Fraktur => "frak",
                Style::Sans => "sans",
                Style::Mono => "mono",
            };
            format!("{function}({})", typst_node(body))
        }
    }
}

fn typst_attach(base: &str, sub: &Option<Box<Node>>, sup: &Option<Box<Node>>) -> String {
    let mut out = format!("attach({base}");
    if let Some(sup) = sup {
        out.push_str(&format!(", t: {}", typst_node(sup)));
    }
    if let Some(sub) = sub {
        out.push_str(&format!(", b: {}", typst_node(sub)));
    }
    out.push(')');
    out
}

/// A formula as Typst math in a content block: `$...$` in the line, `$ ... $`
/// as a block of its own. None if it cannot be read.
pub fn to_typst(latex: &str, display: bool) -> Option<String> {
    let body = typst_node(&parse(latex)?);
    Some(if display { format!("$ {body} $") } else { format!("${body}$") })
}

// ---------------------------------------------------------------------------
// OMML, the equations of Word

const M_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// How the runs inside a node are drawn.
#[derive(Clone, Copy, Default)]
struct Look {
    style: Option<Style>,
    /// Upright, as function names are.
    upright: bool,
    /// Plain text, not math.
    text: bool,
    /// Typewriter font, for what was not understood.
    code: bool,
}

fn run(text: &str, look: Look) -> String {
    let mut properties = String::new();
    if look.text || look.code {
        properties.push_str("<m:nor/>");
    }
    let style = match look.style {
        Some(Style::Bold) => Some(("b", None)),
        Some(Style::Upright) => Some(("p", None)),
        Some(Style::Italic) => Some(("i", None)),
        Some(Style::DoubleStruck) => Some(("p", Some("double-struck"))),
        Some(Style::Script) => Some(("p", Some("script"))),
        Some(Style::Fraktur) => Some(("p", Some("fraktur"))),
        Some(Style::Sans) => Some(("p", Some("sans-serif"))),
        Some(Style::Mono) => Some(("p", Some("monospace"))),
        None if look.upright => Some(("p", None)),
        None => None,
    };
    if let Some((sty, script)) = style {
        if let Some(script) = script {
            properties.push_str(&format!(r#"<m:scr m:val="{script}"/>"#));
        }
        properties.push_str(&format!(r#"<m:sty m:val="{sty}"/>"#));
    }
    let properties = if properties.is_empty() { String::new() } else { format!("<m:rPr>{properties}</m:rPr>") };
    let font = if look.code {
        r#"<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr>"#
    } else {
        ""
    };
    format!(r#"<m:r>{properties}{font}<m:t xml:space="preserve">{}</m:t></m:r>"#, xml(text))
}

fn omml_arg(tag: &str, node: &Node, look: Look) -> String {
    format!("<m:{tag}>{}</m:{tag}>", omml_node(node, look))
}

fn omml_opt(tag: &str, node: &Option<Box<Node>>, look: Look) -> String {
    node.as_ref().map(|n| omml_arg(tag, n, look)).unwrap_or_default()
}

fn omml_row(items: &[Node], look: Look) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < items.len() {
        // A big operator takes what follows it as its body, as Word's own do.
        if let Node::Nary { op, sub, sup } = &items[i] {
            let body = items.get(i + 1).filter(|n| !matches!(n, Node::Sym(_) | Node::Space(_)));
            let integral = matches!(op, '∫' | '∬' | '∭' | '∮');
            let mut properties =
                format!(r#"<m:chr m:val="{op}"/><m:limLoc m:val="{}"/>"#, if integral { "subSup" } else { "undOvr" });
            if sub.is_none() {
                properties.push_str(r#"<m:subHide m:val="1"/>"#);
            }
            if sup.is_none() {
                properties.push_str(r#"<m:supHide m:val="1"/>"#);
            }
            let body_xml = body.map(|n| omml_node(n, look)).unwrap_or_default();
            out.push_str(&format!(
                "<m:nary><m:naryPr>{properties}</m:naryPr>{}{}<m:e>{body_xml}</m:e></m:nary>",
                if sub.is_some() { omml_opt("sub", sub, look) } else { "<m:sub/>".into() },
                if sup.is_some() { omml_opt("sup", sup, look) } else { "<m:sup/>".into() },
            ));
            i += if body.is_some() { 2 } else { 1 };
            continue;
        }
        out.push_str(&omml_node(&items[i], look));
        i += 1;
    }
    out
}

fn omml_delim(open: &Option<String>, close: &Option<String>, body: &str) -> String {
    let chr = |tag: &str, d: &Option<String>| format!(r#"<m:{tag} m:val="{}"/>"#, xml(d.as_deref().unwrap_or("")));
    format!("<m:d><m:dPr>{}{}</m:dPr><m:e>{body}</m:e></m:d>", chr("begChr", open), chr("endChr", close))
}

fn omml_node(node: &Node, look: Look) -> String {
    match node {
        Node::Row(items) => omml_row(items, look),
        Node::Ident(s) | Node::Number(s) | Node::Sym(s) => run(s, look),
        Node::Func { name, .. } => run(name, Look { upright: true, ..look }),
        Node::Text(s) => run(s, Look { text: true, ..look }),
        Node::Raw(s) => run(s, Look { code: true, ..look }),
        Node::Space(kind) => run(
            match kind {
                Space::Thin => "\u{2009}",
                Space::Medium => "\u{2005}",
                Space::Thick => "\u{2004}",
                Space::Quad => "\u{2003}",
                Space::QuadQuad => "\u{2003}\u{2003}",
                Space::Plain => "\u{00A0}",
            },
            Look { text: true, ..look },
        ),
        Node::Frac { num, den, bar } => {
            let properties = if *bar { String::new() } else { r#"<m:fPr><m:type m:val="noBar"/></m:fPr>"#.into() };
            format!("<m:f>{properties}{}{}</m:f>", omml_arg("num", num, look), omml_arg("den", den, look))
        }
        Node::Sqrt { degree, body } => {
            let degree_xml = match degree {
                Some(d) => omml_arg("deg", d, look),
                None => "<m:deg/>".into(),
            };
            let hide = if degree.is_none() { r#"<m:radPr><m:degHide m:val="1"/></m:radPr>"# } else { "" };
            format!("<m:rad>{hide}{degree_xml}{}</m:rad>", omml_arg("e", body, look))
        }
        Node::Script { base, sub, sup } => {
            let below = matches!(&**base, Node::Func { limits: true, .. }) && sub.is_some() && sup.is_none();
            if below {
                return format!("<m:limLow>{}{}</m:limLow>", omml_arg("e", base, look), omml_opt("lim", sub, look));
            }
            let (tag, parts) = match (sub, sup) {
                (Some(_), Some(_)) => {
                    ("sSubSup", format!("{}{}", omml_opt("sub", sub, look), omml_opt("sup", sup, look)))
                }
                (Some(_), None) => ("sSub", omml_opt("sub", sub, look)),
                _ => ("sSup", omml_opt("sup", sup, look)),
            };
            format!("<m:{tag}>{}{parts}</m:{tag}>", omml_arg("e", base, look))
        }
        // A big operator that is not followed by anything still gets its place.
        Node::Nary { .. } => omml_row(std::slice::from_ref(node), look),
        Node::Delim { open, close, body } => omml_delim(open, close, &omml_node(body, look)),
        Node::Matrix { open, close, rows } => {
            let rows: String = rows
                .iter()
                .map(|cells| {
                    let cells: String = cells.iter().map(|c| omml_arg("e", c, look)).collect();
                    format!("<m:mr>{cells}</m:mr>")
                })
                .collect();
            let matrix = format!("<m:m>{rows}</m:m>");
            if open.is_some() || close.is_some() { omml_delim(open, close, &matrix) } else { matrix }
        }
        Node::Cases(rows) => {
            let equations: String = rows
                .iter()
                .map(|cells| {
                    let joined: Vec<String> = cells.iter().map(|c| omml_node(c, look)).collect();
                    format!("<m:e>{}</m:e>", joined.join(&run("\u{2003}", Look { text: true, ..look })))
                })
                .collect();
            omml_delim(&Some("{".into()), &None, &format!("<m:eqArr>{equations}</m:eqArr>"))
        }
        Node::Aligned(rows) => {
            let equations: String = rows.iter().map(|cells| format!("<m:e>{}</m:e>", omml_row(cells, look))).collect();
            format!("<m:eqArr>{equations}</m:eqArr>")
        }
        Node::Accent { kind, body } => match kind {
            Accent::Overline | Accent::Underline => {
                let position = if *kind == Accent::Overline { "top" } else { "bot" };
                format!("<m:bar><m:barPr><m:pos m:val=\"{position}\"/></m:barPr>{}</m:bar>", omml_arg("e", body, look))
            }
            _ => {
                let mark = match kind {
                    Accent::Hat => "\u{0302}",
                    Accent::Tilde => "\u{0303}",
                    Accent::Vec => "\u{20D7}",
                    Accent::Dot => "\u{0307}",
                    Accent::DoubleDot => "\u{0308}",
                    _ => "\u{0304}",
                };
                format!("<m:acc><m:accPr><m:chr m:val=\"{mark}\"/></m:accPr>{}</m:acc>", omml_arg("e", body, look))
            }
        },
        Node::Style { style, body } => omml_node(body, Look { style: Some(*style), ..look }),
    }
}

/// A formula as a Word equation, to go among the runs of a paragraph. None if
/// it cannot be read.
pub fn to_omml(latex: &str, display: bool) -> Option<String> {
    let body = omml_node(&parse(latex)?, Look::default());
    // Both prefixes are declared here, so that the equation stands in any document.
    let namespaces = format!(r#"xmlns:m="{M_NS}" xmlns:w="{W_NS}""#);
    Some(if display {
        format!("<m:oMathPara {namespaces}><m:oMath>{body}</m:oMath></m:oMathPara>")
    } else {
        format!("<m:oMath {namespaces}>{body}</m:oMath>")
    })
}
