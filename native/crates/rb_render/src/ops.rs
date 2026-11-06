//! The engine's half of packages/render/src/ops.ts: apply a frame's ops to a
//! Blitz document, and keep the map between the page's node ids and Blitz's.
//!
//! An op is a JSON array, `[kind, ...fields]`:
//!   ["el", id, tag]  ["text", id, value]  ["comment", id, value]
//!   ["insert", parent, child, before | null]  ["remove", parent, child]
//!   ["attr", id, name, value | null]  ["style", id, prop, value | null]
//!   ["prop", id, "value" | "checked", value]  ["setText", id, value]
//! Node 0 is the root container (`<div id="root">` inside `<body>`).

use blitz_dom::{ns, BaseDocument, LocalName, NodeId, QualName};
use serde_json::Value;
use std::collections::HashMap;

pub const ROOT: u32 = 0;

#[derive(Default)]
pub struct Ids {
    to_blitz: HashMap<u32, NodeId>,
    from_blitz: HashMap<NodeId, u32>,
    /// The value each field last reported as typed, so the page echoing it back
    /// as a `prop` op doesn't reset the field (and its caret) under the user.
    typed: HashMap<u32, String>,
}

impl Ids {
    fn put(&mut self, page: u32, blitz: NodeId) {
        self.to_blitz.insert(page, blitz);
        self.from_blitz.insert(blitz, page);
    }
    fn get(&self, page: u32) -> Result<NodeId, String> {
        self.to_blitz.get(&page).copied().ok_or_else(|| format!("op names node {page}, which no op created"))
    }
    /// The page's id for the nearest node in `chain` that the page made: a click
    /// on a button's text lands on the button.
    pub fn page_id(&self, chain: &[NodeId]) -> Option<u32> {
        chain.iter().find_map(|n| self.from_blitz.get(n).copied())
    }
    pub fn note_typed(&mut self, page: u32, value: &str) {
        self.typed.insert(page, value.to_owned());
    }
}

fn html(tag: &str) -> QualName {
    QualName::new(None, ns!(html), LocalName::from(tag))
}
fn attr(name: &str) -> QualName {
    QualName::new(None, ns!(), LocalName::from(name))
}

/// `<html><body><div id="root">` in a fresh document; the div is node 0.
pub fn mount(doc: &mut BaseDocument, ids: &mut Ids) {
    let top = doc.root_node().id;
    let mut m = doc.mutate();
    let html_el = m.create_element(html("html"), vec![]);
    let body = m.create_element(html("body"), vec![]);
    let root = m.create_element(html("div"), vec![]);
    m.set_attribute(root, attr("id"), "root");
    m.append_children(top, &[html_el]);
    m.append_children(html_el, &[body]);
    m.append_children(body, &[root]);
    ids.put(ROOT, root);
}

/// Applies one frame. Stops at the first op it can't read and says which; the
/// ops before it stay applied, as a browser would have run them.
pub fn apply(doc: &mut BaseDocument, ids: &mut Ids, ops: &[Value]) -> Result<usize, String> {
    let mut m = doc.mutate();
    for (n, op) in ops.iter().enumerate() {
        let a = op.as_array().ok_or_else(|| format!("op {n} is not an array"))?;
        let kind = a.first().and_then(Value::as_str).ok_or_else(|| format!("op {n} has no kind"))?;
        let bad = |i: usize, what: &str| format!("op {n} ({kind}): field {i} is not {what}");
        let id = |i: usize| a.get(i).and_then(Value::as_u64).and_then(|v| u32::try_from(v).ok()).ok_or_else(|| bad(i, "a node id"));
        let text = |i: usize| a.get(i).and_then(Value::as_str).ok_or_else(|| bad(i, "a string"));
        // A null value clears the attribute or style property.
        let maybe = |i: usize| match a.get(i) {
            Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.as_str())),
            _ => Err(bad(i, "a string or null")),
        };
        match kind {
            "el" => { let el = m.create_element(html(&text(2)?.to_ascii_lowercase()), vec![]); ids.put(id(1)?, el); }
            "text" => { let t = m.create_text_node(text(2)?); ids.put(id(1)?, t); }
            // Hydration markers: kept so `insert` can anchor on them; Blitz never paints a comment.
            "comment" => { let c = m.create_comment_node(text(2)?); ids.put(id(1)?, c); }
            "setText" => m.set_node_text(ids.get(id(1)?)?, text(2)?),
            "insert" => {
                let (parent, child) = (ids.get(id(1)?)?, ids.get(id(2)?)?);
                match a.get(3) {
                    None | Some(Value::Null) => m.append_children(parent, &[child]),
                    Some(_) => m.insert_nodes_before(ids.get(id(3)?)?, &[child]),
                }
            }
            // Detached, not dropped: React moves a node by removing and inserting it.
            "remove" => m.remove_node(ids.get(id(2)?)?),
            "attr" => {
                let node = ids.get(id(1)?)?;
                match maybe(3)? {
                    Some(v) => m.set_attribute(node, attr(text(2)?), v),
                    None => m.clear_attribute(node, attr(text(2)?)),
                }
            }
            "style" => {
                let node = ids.get(id(1)?)?;
                match maybe(3)? {
                    Some(v) => m.set_style_property(node, text(2)?, v),
                    None => m.remove_style_property(node, text(2)?),
                }
            }
            "prop" => {
                let page = id(1)?;
                let node = ids.get(page)?;
                match (text(2)?, a.get(3)) {
                    ("value", Some(Value::String(v))) => {
                        if ids.typed.remove(&page).as_deref() != Some(v.as_str()) {
                            m.set_attribute(node, attr("value"), v);
                        }
                    }
                    ("checked", Some(Value::Bool(true))) => m.set_attribute(node, attr("checked"), ""),
                    ("checked", Some(Value::Bool(false))) => m.clear_attribute(node, attr("checked")),
                    _ => return Err(bad(3, "a value for that prop")),
                }
            }
            other => return Err(format!("op {n}: unknown kind {other:?}")),
        }
    }
    Ok(ops.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use blitz_dom::DocumentConfig;
    use serde_json::json;

    fn page() -> (BaseDocument, Ids) {
        let mut doc = BaseDocument::new(DocumentConfig::default());
        let mut ids = Ids::default();
        mount(&mut doc, &mut ids);
        (doc, ids)
    }

    fn text_of(doc: &BaseDocument, ids: &Ids, page: u32) -> String {
        doc.get_node(ids.get(page).unwrap()).unwrap().text_content()
    }

    #[test]
    fn a_frame_builds_moves_and_edits_the_tree() {
        let (mut doc, mut ids) = page();
        let frame = json!([
            ["el", 1, "ul"], ["el", 2, "li"], ["text", 3, "milk"], ["el", 4, "li"], ["text", 5, "eggs"],
            ["comment", 6, "$"],
            ["insert", 2, 3, null], ["insert", 4, 5, null],
            ["insert", 1, 4, null], ["insert", 1, 2, 4], ["insert", 0, 6, null], ["insert", 0, 1, 6],
            ["attr", 1, "class", "list"], ["style", 2, "color", "red"],
        ]);
        apply(&mut doc, &mut ids, frame.as_array().unwrap()).unwrap();
        assert_eq!(text_of(&doc, &ids, ROOT), "milkeggs");

        // React moves eggs to the front, then renames milk.
        let edit = json!([["remove", 1, 4], ["insert", 1, 4, 2], ["setText", 3, "oat milk"], ["attr", 1, "class", null]]);
        apply(&mut doc, &mut ids, edit.as_array().unwrap()).unwrap();
        assert_eq!(text_of(&doc, &ids, 1), "eggsoat milk");
        let ul = doc.get_node(ids.get(1).unwrap()).unwrap();
        assert_eq!(ul.attr(LocalName::from("class")), None);
    }

    #[test]
    fn a_bad_op_says_which_and_keeps_the_ones_before_it() {
        let (mut doc, mut ids) = page();
        let frame = json!([["text", 1, "hi"], ["insert", 0, 1, null], ["insert", 0, 99, null]]);
        let err = apply(&mut doc, &mut ids, frame.as_array().unwrap()).unwrap_err();
        assert!(err.contains("node 99"), "{err}");
        assert_eq!(text_of(&doc, &ids, ROOT), "hi");
    }
}
