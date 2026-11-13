//! The order of the file tree, chosen per vault and kept in `.ultimatemd/orden.json`,
//! so it travels with the vault. Files are never renamed to get an order.
//!
//! Folders always come first. Within each kind the order is by name (natural,
//! ignoring case and accents) or by date, or a manual one: for each folder, the
//! names of what is in it, as the user placed them. What is not in that list goes
//! after what is, by name.

use crate::files::{TreeNode, atomic_write};
use crate::paths::normalize;
use crate::vault_themes::FOLDER;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

const FILE: &str = "orden.json";
const MAX_FILE: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortMode {
    #[default]
    NameAsc,
    NameDesc,
    ModifiedNew,
    ModifiedOld,
    Manual,
}

/// What is stored. `manual` maps a folder (`""` for the vault) to its children's names.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Order {
    pub mode: SortMode,
    pub manual: BTreeMap<String, Vec<String>>,
}

type Keyed = (String, TreeNode, u64);

fn file(root: &Path) -> std::path::PathBuf {
    root.join(FOLDER).join(FILE)
}

/// The vault's order. A missing or damaged file means the default one.
pub fn load(root: &Path) -> Order {
    let path = file(root);
    let small = std::fs::metadata(&path).is_ok_and(|m| m.len() <= MAX_FILE);
    small
        .then(|| std::fs::read_to_string(&path).ok())
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, order: &Order) -> Result<()> {
    std::fs::create_dir_all(root.join(FOLDER))?;
    atomic_write(&file(root), serde_json::to_string_pretty(order)?.as_bytes())
}

pub fn set_mode(root: &Path, mode: SortMode) -> Result<()> {
    let mut order = load(root);
    order.mode = mode;
    save(root, &order)
}

fn split(rel: &str) -> (&str, &str) {
    rel.rsplit_once('/').unwrap_or(("", rel))
}

/// Puts `path` next to `target`, which must be in the same folder and of the same
/// kind (both folders or both not), and keeps the result as that folder's order.
/// `children` are the folder's entries in the order they show now.
pub fn place(root: &Path, children: &[TreeNode], path: &str, target: &str, after: bool) -> Result<()> {
    let (path, target) = (normalize(path)?, normalize(target)?);
    let (dir, name) = split(&path);
    let find = |p: &str| children.iter().find(|n| n.path == p);
    let (Some(moving), Some(other)) = (find(&path), find(&target)) else {
        return Err(Error::NotFound(path));
    };
    if split(&target).0 != dir || moving.is_dir != other.is_dir {
        return Err(Error::PathNotAllowed(target));
    }
    let mut names: Vec<String> = children.iter().map(|n| n.name.clone()).filter(|n| n != name).collect();
    let at = names.iter().position(|n| *n == other.name).map_or(names.len(), |i| i + usize::from(after));
    names.insert(at, name.to_string());
    let mut order = load(root);
    order.manual.insert(dir.to_string(), names);
    save(root, &order)
}

/// Keeps the order right after `from` became `to`: the name stays where it was when
/// it only changed, goes from the old folder's list when it moved, and the lists of
/// the folders inside follow it.
pub fn renamed(root: &Path, from: &str, to: &str) {
    let mut order = load(root);
    if order.manual.is_empty() {
        return;
    }
    let (old_dir, old_name) = split(from);
    let (new_dir, new_name) = split(to);
    if let Some(list) = order.manual.get_mut(old_dir) {
        if old_dir == new_dir {
            list.iter_mut().filter(|n| *n == old_name).for_each(|n| *n = new_name.to_string());
        } else {
            list.retain(|n| n != old_name);
        }
    }
    let inside = format!("{from}/");
    let moved: Vec<String> = order.manual.keys().filter(|k| *k == from || k.starts_with(&inside)).cloned().collect();
    for key in moved {
        if let Some(list) = order.manual.remove(&key) {
            order.manual.insert(format!("{to}{}", &key[from.len()..]), list);
        }
    }
    let _ = save(root, &order);
}

/// Forgets `rel` after it was deleted for good.
pub fn removed(root: &Path, rel: &str) {
    let mut order = load(root);
    if order.manual.is_empty() {
        return;
    }
    let (dir, name) = split(rel);
    if let Some(list) = order.manual.get_mut(dir) {
        list.retain(|n| n != name);
    }
    let inside = format!("{rel}/");
    order.manual.retain(|k, _| k != rel && !k.starts_with(&inside));
    let _ = save(root, &order);
}

/// What a name sorts as: lower case, without accents.
fn fold(name: &str) -> String {
    name.nfd().filter(|c| !('\u{300}'..='\u{36f}').contains(c)).flat_map(char::to_lowercase).collect()
}

/// A run of digits without its leading zeros.
fn number(it: &mut std::iter::Peekable<std::str::Chars>) -> String {
    let mut digits = String::new();
    while let Some(d) = it.next_if(char::is_ascii_digit) {
        digits.push(d);
    }
    digits.trim_start_matches('0').to_string()
}

/// Compares two folded names so that "2" comes before "10".
fn natural(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let (x, y) = (number(&mut a), number(&mut b));
                let by = x.len().cmp(&y.len()).then_with(|| x.cmp(&y));
                if by != Ordering::Equal {
                    return by;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                a.next();
                b.next();
            }
        }
    }
}

fn by_name(a: &Keyed, b: &Keyed) -> Ordering {
    natural(&a.0, &b.0).then_with(|| a.1.name.cmp(&b.1.name))
}

/// Sorts the entries of the folder `dir` ('' for the vault), each with when it last
/// changed (for a folder, the newest note inside).
pub fn sort(entries: Vec<(TreeNode, u64)>, dir: &str, order: &Order) -> Vec<TreeNode> {
    let mut keyed: Vec<Keyed> = entries.into_iter().map(|(n, t)| (fold(&n.name), n, t)).collect();
    let position: HashMap<&str, usize> = match (order.mode, order.manual.get(dir)) {
        (SortMode::Manual, Some(list)) => list.iter().enumerate().map(|(i, n)| (n.as_str(), i)).collect(),
        _ => HashMap::new(),
    };
    keyed.sort_by(|a, b| {
        b.1.is_dir.cmp(&a.1.is_dir).then_with(|| match order.mode {
            SortMode::NameAsc => by_name(a, b),
            SortMode::NameDesc => by_name(b, a),
            SortMode::ModifiedNew => b.2.cmp(&a.2).then_with(|| by_name(a, b)),
            SortMode::ModifiedOld => a.2.cmp(&b.2).then_with(|| by_name(a, b)),
            SortMode::Manual => {
                let at = |n: &TreeNode| position.get(n.name.as_str()).copied().unwrap_or(usize::MAX);
                at(&a.1).cmp(&at(&b.1)).then_with(|| by_name(a, b))
            }
        })
    });
    keyed.into_iter().map(|(_, n, _)| n).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(name: &str, is_dir: bool) -> TreeNode {
        TreeNode { name: name.into(), path: name.into(), is_dir, children: Vec::new() }
    }
    fn names(nodes: &[TreeNode]) -> Vec<&str> {
        nodes.iter().map(|n| n.name.as_str()).collect()
    }
    fn entries(list: &[(&str, bool, u64)]) -> Vec<(TreeNode, u64)> {
        list.iter().map(|(n, d, t)| (node(n, *d), *t)).collect()
    }
    fn mode(mode: SortMode) -> Order {
        Order { mode, ..Order::default() }
    }

    #[test]
    fn names_sort_naturally_without_case_or_accents() {
        let list = entries(&[
            ("10.md", false, 0),
            ("2.md", false, 0),
            ("Árbol.md", false, 0),
            ("avión.md", false, 0),
            ("Zeta.md", false, 0),
            ("ñu.md", false, 0),
        ]);
        let up = sort(list.clone(), "", &mode(SortMode::NameAsc));
        assert_eq!(names(&up), ["2.md", "10.md", "Árbol.md", "avión.md", "ñu.md", "Zeta.md"]);
        let down = sort(list, "", &mode(SortMode::NameDesc));
        assert_eq!(names(&down), ["Zeta.md", "ñu.md", "avión.md", "Árbol.md", "10.md", "2.md"]);
    }

    #[test]
    fn folders_come_first_in_every_mode() {
        let list = entries(&[("a.md", false, 9), ("b", true, 1), ("c.md", false, 5), ("d", true, 7)]);
        for m in [SortMode::NameAsc, SortMode::NameDesc, SortMode::ModifiedNew, SortMode::ModifiedOld, SortMode::Manual]
        {
            let sorted = sort(list.clone(), "", &mode(m));
            assert!(sorted[0].is_dir && sorted[1].is_dir && !sorted[2].is_dir, "{m:?}");
        }
        assert_eq!(names(&sort(list.clone(), "", &mode(SortMode::ModifiedNew))), ["d", "b", "a.md", "c.md"]);
        assert_eq!(names(&sort(list, "", &mode(SortMode::ModifiedOld))), ["b", "d", "c.md", "a.md"]);
    }

    #[test]
    fn manual_puts_what_is_listed_first_and_the_rest_by_name() {
        let list = entries(&[("a.md", false, 0), ("b.md", false, 0), ("c.md", false, 0), ("d.md", false, 0)]);
        let listed = vec!["c.md".to_string(), "gone.md".into(), "b.md".into()];
        let order = Order { mode: SortMode::Manual, manual: [(String::new(), listed)].into() };
        assert_eq!(names(&sort(list.clone(), "", &order)), ["c.md", "b.md", "a.md", "d.md"]);
        // Another folder has no list.
        assert_eq!(names(&sort(list.clone(), "x", &order)), ["a.md", "b.md", "c.md", "d.md"]);
        // The list is kept, but only used in manual mode.
        let kept = Order { mode: SortMode::NameAsc, ..order };
        assert_eq!(names(&sort(list, "", &kept)), ["a.md", "b.md", "c.md", "d.md"]);
    }

    #[test]
    fn the_order_is_kept_in_the_vault_and_follows_renames_and_deletions() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        assert_eq!(load(root), Order::default());
        set_mode(root, SortMode::Manual).unwrap();
        let children = vec![node("a.md", false), node("b.md", false), node("c.md", false)];
        place(root, &children, "c.md", "a.md", false).unwrap();
        let list = |dir: &str| load(root).manual.get(dir).cloned().unwrap_or_default();
        assert_eq!(list(""), ["c.md", "a.md", "b.md"]);
        assert_eq!(load(root).mode, SortMode::Manual);

        renamed(root, "a.md", "z.md");
        assert_eq!(list(""), ["c.md", "z.md", "b.md"]);
        renamed(root, "b.md", "sub/b.md");
        assert_eq!(list(""), ["c.md", "z.md"]);
        removed(root, "c.md");
        assert_eq!(list(""), ["z.md"]);

        let mut order = load(root);
        order.manual.insert("dir".into(), vec!["1.md".into()]);
        order.manual.insert("dir/in".into(), vec!["2.md".into()]);
        save(root, &order).unwrap();
        renamed(root, "dir", "otra");
        assert_eq!(list("otra/in"), ["2.md"]);
        assert!(list("dir").is_empty());
        removed(root, "otra");
        assert!(list("otra/in").is_empty());
    }

    #[test]
    fn placing_refuses_other_folders_and_other_kinds() {
        let d = tempfile::tempdir().unwrap();
        let children = vec![node("f", true), node("a.md", false)];
        assert!(place(d.path(), &children, "a.md", "f", false).is_err());
        assert!(place(d.path(), &children, "a.md", "nope.md", false).is_err());
    }

    #[test]
    fn a_damaged_file_means_the_default_order() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(d.path().join(FOLDER)).unwrap();
        std::fs::write(file(d.path()), "{ no").unwrap();
        assert_eq!(load(d.path()), Order::default());
    }
}
