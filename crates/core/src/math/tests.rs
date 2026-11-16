use super::*;

fn well_formed(xml: &str) {
    roxmltree::Document::parse(xml).unwrap_or_else(|e| panic!("not well formed: {e}\n{xml}"));
}

#[test]
fn every_common_formula_becomes_an_equation_and_typst_math() {
    for latex in SAMPLES {
        for display in [false, true] {
            let omml = to_omml(latex, display).unwrap_or_else(|| panic!("no OMML for {latex}"));
            well_formed(&omml);
            assert!(to_typst(latex, display).is_some(), "no Typst for {latex}");
        }
    }
}

#[test]
fn fractions_scripts_and_roots_in_omml() {
    let omml = to_omml(r"\frac{a}{b}", false).unwrap();
    assert!(omml.contains("<m:f><m:num>") && omml.contains("<m:den>"), "{omml}");
    let omml = to_omml("x_i^2", false).unwrap();
    assert!(omml.contains("<m:sSubSup>") && omml.contains("<m:sub>") && omml.contains("<m:sup>"), "{omml}");
    let omml = to_omml(r"\sqrt[3]{x}", false).unwrap();
    assert!(omml.contains("<m:rad>") && omml.contains("<m:deg><m:r>"), "{omml}");
    let omml = to_omml(r"\sqrt{x}", false).unwrap();
    assert!(omml.contains(r#"<m:degHide m:val="1"/>"#), "{omml}");
}

#[test]
fn a_big_operator_takes_the_term_after_it_as_its_body() {
    let omml = to_omml(r"\sum_{i=1}^n i^2 + 1", false).unwrap();
    assert!(omml.contains("<m:nary>") && omml.contains(r#"m:chr m:val="∑""#) && omml.contains("undOvr"), "{omml}");
    let body = omml.split("<m:e>").nth(1).unwrap();
    assert!(body.contains("<m:sSup>"), "the body is i squared: {omml}");
    let omml = to_omml(r"\int_0^1 f", false).unwrap();
    assert!(omml.contains("subSup"), "integrals keep their limits at the side: {omml}");
    let omml = to_omml(r"\sum", false).unwrap();
    assert!(omml.contains("<m:subHide"), "{omml}");
}

#[test]
fn limits_go_below_their_function() {
    assert!(to_omml(r"\lim_{x\to0} f", false).unwrap().contains("<m:limLow>"));
    assert!(to_omml(r"\log_2 n", false).unwrap().contains("<m:sSub>"));
}

#[test]
fn matrices_cases_and_delimiters() {
    let omml = to_omml(r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}", false).unwrap();
    assert_eq!(omml.matches("<m:mr>").count(), 2);
    assert_eq!(omml.matches("<m:e>").count() - 1, 4, "four cells and the fence: {omml}");
    assert!(omml.contains(r#"<m:begChr m:val="("/>"#));
    let omml = to_omml(r"\begin{cases} 1 & a \\ 0 & b \end{cases}", false).unwrap();
    assert!(omml.contains("<m:eqArr>") && omml.contains(r#"<m:begChr m:val="{"/>"#), "{omml}");
    let omml = to_omml(r"\left[ x \right)", false).unwrap();
    assert!(omml.contains(r#"<m:begChr m:val="["/>"#) && omml.contains(r#"<m:endChr m:val=")"/>"#), "{omml}");
}

#[test]
fn text_and_styles() {
    let omml = to_omml(r"\text{si } x", false).unwrap();
    assert!(omml.contains("<m:nor/>") && omml.contains(">si <"), "{omml}");
    let omml = to_omml(r"\mathbf{v}", false).unwrap();
    assert!(omml.contains(r#"<m:sty m:val="b"/>"#), "{omml}");
    let omml = to_omml(r"\sin x", false).unwrap();
    assert!(omml.contains(r#"<m:sty m:val="p"/>"#), "functions are upright: {omml}");
}

#[test]
fn a_display_formula_is_a_math_paragraph() {
    assert!(to_omml("x", true).unwrap().starts_with("<m:oMathPara"));
    assert!(to_omml("x", false).unwrap().starts_with("<m:oMath "));
}

#[test]
fn what_is_not_understood_stays_as_text() {
    let omml = to_omml(r"a + \unknowncommand{x}", false).unwrap();
    assert!(omml.contains(r"\unknowncommand") && omml.contains("Consolas"), "{omml}");
    let typst = to_typst(r"a + \unknowncommand", false).unwrap();
    assert!(typst.contains(r#"mono("\\unknowncommand")"#), "{typst}");
}

#[test]
fn a_formula_that_cannot_be_read_gives_nothing() {
    for latex in [r"\frac{1", "x^", "{a", r"a}", r"\left( x", r"\begin{pmatrix} a", r"\end{x}", "", "   ", "^2"] {
        assert!(parse(latex).is_none(), "{latex:?}");
        assert!(to_omml(latex, false).is_none());
        assert!(to_typst(latex, false).is_none());
    }
    assert!(parse(&"{".repeat(500)).is_none(), "deep nesting is refused, not a crash");
    assert!(parse(&"x".repeat(MAX_LENGTH + 1)).is_none());
}

#[test]
fn typst_math_of_the_common_shapes() {
    assert_eq!(to_typst("x^2", false).unwrap(), "$attach(x, t: 2)$");
    assert_eq!(to_typst(r"\frac{a}{b}", true).unwrap(), "$ frac(a, b) $");
    assert_eq!(to_typst(r"\sqrt[3]{x}", false).unwrap(), "$root(3, x)$");
    assert_eq!(to_typst(r"a/b", false).unwrap(), "$a slash b$", "a slash is a slash, not a fraction");
    assert_eq!(to_typst(r"f(a, b)", false).unwrap(), r"$f \( a comma b \)$");
    assert_eq!(to_typst(r"\sum_{i=1}^n i", false).unwrap(), "$attach(∑, t: n, b: i = 1) i$");
    assert_eq!(to_typst(r"\lim_{x\to0} f", false).unwrap(), "$attach(op(\"lim\", limits: #true), b: x → 0) f$");
    assert_eq!(to_typst(r"\begin{pmatrix}1&2\\3&4\end{pmatrix}", false).unwrap(), "$mat(delim: \"(\", 1, 2; 3, 4)$");
    assert_eq!(to_typst(r"\text{if } x", false).unwrap(), "$\"if \" x$");
    assert_eq!(to_typst("a = b \\\\ c = d", true).unwrap(), "$ a = b \\ c = d $");
}

#[test]
fn a_price_is_not_a_formula_but_a_formula_is() {
    let kinds = |text: &str| {
        events(text)
            .filter_map(|e| match e {
                Event::InlineMath(m) => Some(format!("math:{m}")),
                Event::DisplayMath(m) => Some(format!("display:{m}")),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(kinds("Sea $x^2$ y $$a+b$$ fin"), ["math:x^2", "display:a+b"]);
    assert!(kinds("cuesta 5$ y 10$").is_empty());
    assert!(kinds("cuesta $5 y $10 en total").is_empty());
    assert!(kinds("a $b$5").is_empty(), "a closing dollar before a digit");
    assert!(kinds(r"pago \$x\$ hoy").is_empty());
    assert!(kinds("`$x$`").is_empty());
    assert_eq!(kinds("$a$, $b$."), ["math:a", "math:b"]);
    let text: String =
        events("a $b$5").filter_map(|e| if let Event::Text(t) = e { Some(t.to_string()) } else { None }).collect();
    assert_eq!(text, "a $b$5", "what was written is kept");
}
