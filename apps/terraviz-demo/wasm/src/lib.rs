//! A Science On a Sphere tour, read as slides.
//!
//! A tour script (`{"tourTasks": [...]}`, the format NOAA's SOS and TerraViz both play) is a flat list of
//! tasks: show a caption, fly somewhere, load a dataset, pause. A room full of people following one presenter
//! wants it as slides: "3 of 9, Arctic sea ice". A slide is the run of tasks up to and including a pause
//! (`pauseForInput`, `pauseSec`, `pauseSeconds`); tasks after the last pause are a closing slide when they show
//! something, and the last slide's tidy-up when they only hide and reset.
//!
//! The same code runs three ways: as wasm in the page (the `outline` export), as a crate in a Rust app such as
//! TerraViz's own Tauri desktop (`slides`, `slide_at`), and under `cargo test` here. It reads JSON and writes
//! JSON, so the host needs nothing else.

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

/// One slide: where it starts in the task list, what it says and shows.
#[derive(Debug, Clone, PartialEq)]
pub struct Slide {
    /// Index of the slide's first task.
    pub first: usize,
    /// Index of its last task (the pause, or the end of the tour).
    pub last: usize,
    /// First line of the first caption shown, with SOS colour tags removed; empty when the slide has none.
    pub title: String,
    /// The dataset a `loadDataset` task in the slide asks for, if any.
    pub dataset: Option<String>,
    /// Where a `flyTo` in the slide lands: (lat, lon).
    pub place: Option<(f64, f64)>,
    /// Seconds a `pauseSec` holds, or None for a pause that waits for the presenter.
    pub hold: Option<f64>,
}

/// What stops a script from being a tour anyone can follow.
#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    pub task: Option<usize>,
    pub what: String,
}

fn is_pause(key: &str) -> bool {
    matches!(key, "pauseForInput" | "pauseSec" | "pauseSeconds")
}

/// A caption's first line, without `<color=...>`, `<i>` and the other SOS text tags.
fn title_of(caption: &str) -> String {
    let first = caption.split("\\n").next().unwrap_or("").split('\n').next().unwrap_or("");
    let mut out = String::with_capacity(first.len());
    let mut in_tag = false;
    for c in first.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn fresh(first: usize) -> Slide {
    Slide { first, last: first, title: String::new(), dataset: None, place: None, hold: None }
}

/// The slides of a tour document, and the issues found on the way. An unreadable document is one issue and no slides.
pub fn slides(tour: &Value) -> (Vec<Slide>, Vec<Issue>) {
    let Some(tasks) = tour.get("tourTasks").and_then(Value::as_array) else {
        return (vec![], vec![Issue { task: None, what: "no tourTasks list".into() }]);
    };
    let mut out = Vec::new();
    let mut issues = Vec::new();
    let mut open: Vec<String> = Vec::new(); // showRect ids not yet hidden
    let mut cur = fresh(0);
    for (i, task) in tasks.iter().enumerate() {
        let Some(obj) = task.as_object() else {
            issues.push(Issue { task: Some(i), what: "task is not an object".into() });
            continue;
        };
        let Some((key, val)) = obj.iter().next() else {
            issues.push(Issue { task: Some(i), what: "task has no key".into() });
            continue;
        };
        if obj.len() != 1 {
            issues.push(Issue { task: Some(i), what: format!("task has {} keys; one is the task", obj.len()) });
        }
        match key.as_str() {
            "showRect" => {
                if let Some(id) = val.get("rectID").and_then(Value::as_str) {
                    open.push(id.to_string());
                }
                if cur.title.is_empty() {
                    if let Some(c) = val.get("caption").and_then(Value::as_str) {
                        cur.title = title_of(c);
                    }
                }
            }
            "hideRect" => {
                if let Some(id) = val.as_str() {
                    if let Some(p) = open.iter().position(|o| o == id) {
                        open.remove(p);
                    } else {
                        issues.push(Issue { task: Some(i), what: format!("hideRect {id:?} hides nothing shown") });
                    }
                }
            }
            "loadDataset" => {
                let id = val.get("id").and_then(Value::as_str).or_else(|| val.as_str());
                match id {
                    Some(id) if !id.is_empty() => cur.dataset = Some(id.to_string()),
                    _ => issues.push(Issue { task: Some(i), what: "loadDataset without an id".into() }),
                }
            }
            "flyTo" => match (val.get("lat").and_then(num), val.get("lon").and_then(num)) {
                (Some(lat), Some(lon)) if (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon) => cur.place = Some((lat, lon)),
                _ => issues.push(Issue { task: Some(i), what: "flyTo needs lat -90..90 and lon -180..180".into() }),
            },
            k if is_pause(k) => {
                cur.hold = if k == "pauseForInput" { None } else { num(val).filter(|s| *s >= 0.0) };
                if k != "pauseForInput" && cur.hold.is_none() {
                    issues.push(Issue { task: Some(i), what: format!("{k} needs a number of seconds") });
                }
                cur.last = i;
                out.push(std::mem::replace(&mut cur, fresh(i + 1)));
            }
            _ => {}
        }
    }
    // what follows the last pause: a closing slide when it shows something, otherwise the tidy-up of the slide before
    if cur.first < tasks.len() {
        cur.last = tasks.len() - 1;
        let bare = cur.title.is_empty() && cur.dataset.is_none() && cur.place.is_none();
        match out.last_mut() {
            Some(prev) if bare => prev.last = cur.last,
            _ => out.push(cur),
        }
    }
    for id in open {
        issues.push(Issue { task: None, what: format!("showRect {id:?} is never hidden") });
    }
    if tasks.is_empty() {
        issues.push(Issue { task: None, what: "the tour has no tasks".into() });
    }
    (out, issues)
}

/// Which slide (0-based) holds task `index`; the last slide for an index past the end.
pub fn slide_at(slides: &[Slide], index: usize) -> usize {
    slides.iter().position(|s| index <= s.last).unwrap_or(slides.len().saturating_sub(1))
}

fn to_json(slides: &[Slide], issues: &[Issue]) -> Value {
    json!({
        "slides": slides.iter().map(|s| json!({
            "first": s.first, "last": s.last, "title": s.title, "dataset": s.dataset,
            "lat": s.place.map(|p| p.0), "lon": s.place.map(|p| p.1), "hold": s.hold,
        })).collect::<Vec<_>>(),
        "issues": issues.iter().map(|i| json!({ "task": i.task, "what": i.what })).collect::<Vec<_>>(),
    })
}

/// The page's entry: tour JSON text in, `{ slides: [...], issues: [...] }` JSON text out. Never throws: text
/// that isn't JSON is one issue.
#[wasm_bindgen]
pub fn outline(tour_json: &str) -> String {
    match serde_json::from_str::<Value>(tour_json) {
        Ok(v) => {
            let (s, i) = slides(&v);
            to_json(&s, &i).to_string()
        }
        Err(e) => to_json(&[], &[Issue { task: None, what: format!("not JSON: {e}") }]).to_string(),
    }
}

/// Which slide holds task `index` in `tour_json`, for a page that only has the engine's task counter.
#[wasm_bindgen]
pub fn slide_of(tour_json: &str, index: usize) -> usize {
    let Ok(v) = serde_json::from_str::<Value>(tour_json) else { return 0 };
    slide_at(&slides(&v).0, index)
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOUR: &str = r#"{"tourTasks": [
        {"setGlobeRotationRate": 0.3},
        {"showRect": {"rectID": "welcome", "caption": "Climate Connections\\nHow Earth's Systems Tell One Story\\n\\n<i><color=green>Four datasets.</color></i>"}},
        {"pauseForInput": ""},
        {"hideRect": "welcome"},
        {"loadDataset": {"id": "INTERNAL_SOS_420_VIDEO", "showLegend": true}},
        {"flyTo": {"lat": 40.0, "lon": -95.0, "altmi": 5000.0, "animated": true}},
        {"showRect": {"rectID": "temp", "caption": "<color=orange>Temperature anomalies</color> since 1850"}},
        {"pauseSec": 4},
        {"hideRect": "temp"},
        {"resetCameraZoomOut": ""}
    ]}"#;

    #[test]
    fn a_tour_reads_as_slides() {
        let v: Value = serde_json::from_str(TOUR).unwrap();
        let (s, issues) = slides(&v);
        assert!(issues.is_empty(), "{issues:?}");
        assert_eq!(s.len(), 2, "the hide and reset after the last pause belong to the last slide");
        assert_eq!((s[0].first, s[0].last, s[0].title.as_str(), s[0].hold), (0, 2, "Climate Connections", None));
        assert_eq!(s[1].title, "Temperature anomalies since 1850");
        assert_eq!(s[1].dataset.as_deref(), Some("INTERNAL_SOS_420_VIDEO"));
        assert_eq!(s[1].place, Some((40.0, -95.0)));
        assert_eq!(s[1].hold, Some(4.0));
        assert_eq!((s[1].first, s[1].last), (3, 9));
        assert_eq!([0, 2, 3, 7, 8, 40].map(|i| slide_at(&s, i)), [0, 0, 1, 1, 1, 1]);
        // a closing caption after the last pause is its own slide
        let v: Value = serde_json::from_str(&TOUR.replace(r#"{"resetCameraZoomOut": ""}"#, r#"{"showRect": {"rectID": "bye", "caption": "Thanks"}}, {"hideRect": "bye"}"#)).unwrap();
        let (s, _) = slides(&v);
        assert_eq!((s.len(), s[2].title.as_str(), s[2].first), (3, "Thanks", 8));
    }

    #[test]
    fn what_is_wrong_is_said_and_the_rest_still_reads() {
        let bad = r#"{"tourTasks": [
            {"showRect": {"rectID": "a", "caption": "A"}},
            {"flyTo": {"lat": 200, "lon": 0}},
            {"loadDataset": {}},
            {"pauseSec": "soon"},
            {"hideRect": "zzz"},
            7
        ]}"#;
        let (s, issues) = slides(&serde_json::from_str(bad).unwrap());
        assert_eq!(s.len(), 1);
        let what: Vec<&str> = issues.iter().map(|i| i.what.as_str()).collect();
        assert_eq!(what, [
            "flyTo needs lat -90..90 and lon -180..180", "loadDataset without an id", "pauseSec needs a number of seconds",
            "hideRect \"zzz\" hides nothing shown", "task is not an object", "showRect \"a\" is never hidden",
        ]);
        let o: Value = serde_json::from_str(&outline("not json")).unwrap();
        assert_eq!(o["slides"].as_array().unwrap().len(), 0);
        assert!(o["issues"][0]["what"].as_str().unwrap().starts_with("not JSON"));
        assert_eq!(slide_of(TOUR, 5), 1);
    }
}
