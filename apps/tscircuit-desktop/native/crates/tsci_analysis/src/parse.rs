//! Circuit JSON straight into the few fields the analysis reads.
//!
//! A generic `serde_json::Value` tree costs a sorted map and an owned string per
//! object and field: on a 100k-trace board that was more time than the analysis.
//! These types borrow strings from the input (`Cow` only copies when a string has
//! escapes) and skip every field they don't name.
//!
//! Lenient on purpose, like the TS twin: a field of the wrong type reads as
//! missing, a non-object element reads as an element with no fields. Only a
//! top level that isn't an array (or isn't JSON) is an error.

use serde::de::{self, Deserialize, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use std::borrow::Cow;
use std::fmt;
use std::marker::PhantomData;

/// Visitor methods for "not what I wanted": consume the value, return the default.
macro_rules! default_for_the_rest {
    ($out:ty) => {
        fn visit_bool<E: de::Error>(self, _: bool) -> Result<$out, E> { Ok(Default::default()) }
        fn visit_i64<E: de::Error>(self, _: i64) -> Result<$out, E> { Ok(Default::default()) }
        fn visit_u64<E: de::Error>(self, _: u64) -> Result<$out, E> { Ok(Default::default()) }
        fn visit_f64<E: de::Error>(self, _: f64) -> Result<$out, E> { Ok(Default::default()) }
        fn visit_str<E: de::Error>(self, _: &str) -> Result<$out, E> { Ok(Default::default()) }
        fn visit_unit<E: de::Error>(self) -> Result<$out, E> { Ok(Default::default()) }
        fn visit_none<E: de::Error>(self) -> Result<$out, E> { Ok(Default::default()) }
    };
}
macro_rules! default_for_containers {
    ($out:ty) => {
        fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<$out, A::Error> {
            while s.next_element::<IgnoredAny>()?.is_some() {}
            Ok(Default::default())
        }
        fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<$out, A::Error> {
            while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
            Ok(Default::default())
        }
    };
}

/// A number, or None for anything else (JS: `typeof v === "number"`).
#[derive(Default, Clone, Copy)]
pub struct Num(pub Option<f64>);

impl<'de> Deserialize<'de> for Num {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Num;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("anything") }
            // Same conversions as Value::as_f64.
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Num, E> { Ok(Num(Some(v as f64))) }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Num, E> { Ok(Num(Some(v as f64))) }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Num, E> { Ok(Num(Some(v))) }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Num, E> { Ok(Num(None)) }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<Num, E> { Ok(Num(None)) }
            fn visit_unit<E: de::Error>(self) -> Result<Num, E> { Ok(Num(None)) }
            fn visit_none<E: de::Error>(self) -> Result<Num, E> { Ok(Num(None)) }
            default_for_containers!(Num);
        }
        d.deserialize_any(V)
    }
}

/// A string, or None for anything else. Borrowed from the input when it can be.
#[derive(Default, Clone)]
pub struct Str<'a>(pub Option<Cow<'a, str>>);

impl<'a> Str<'a> {
    /// The string, or "" when missing (the twin's `str(e, k)`).
    pub fn get(&self) -> &str { self.0.as_deref().unwrap_or("") }
}

impl<'de> Deserialize<'de> for Str<'de> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Str<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("anything") }
            fn visit_borrowed_str<E: de::Error>(self, v: &'de str) -> Result<Str<'de>, E> { Ok(Str(Some(Cow::Borrowed(v)))) }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Str<'de>, E> { Ok(Str(Some(Cow::Owned(v.to_owned())))) }
            fn visit_string<E: de::Error>(self, v: String) -> Result<Str<'de>, E> { Ok(Str(Some(Cow::Owned(v)))) }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Str<'de>, E> { Ok(Str(None)) }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Str<'de>, E> { Ok(Str(None)) }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Str<'de>, E> { Ok(Str(None)) }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Str<'de>, E> { Ok(Str(None)) }
            fn visit_unit<E: de::Error>(self) -> Result<Str<'de>, E> { Ok(Str(None)) }
            fn visit_none<E: de::Error>(self) -> Result<Str<'de>, E> { Ok(Str(None)) }
            default_for_containers!(Str<'de>);
        }
        d.deserialize_any(V)
    }
}

/// An array's items, or empty for anything else.
pub struct List<T>(pub Vec<T>);

impl<T> Default for List<T> { fn default() -> Self { List(Vec::new()) } }

impl<'de, T: Deserialize<'de>> Deserialize<'de> for List<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for V<T> {
            type Value = List<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("anything") }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<List<T>, A::Error> {
                let mut out = Vec::with_capacity(s.size_hint().unwrap_or(0));
                while let Some(v) = s.next_element()? { out.push(v); }
                Ok(List(out))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<List<T>, A::Error> {
                while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(List(Vec::new()))
            }
            default_for_the_rest!(List<T>);
        }
        d.deserialize_any(V(PhantomData))
    }
}

/// A lenient object: named fields are read (last duplicate wins, like Value),
/// everything else is skipped, and a non-object is all defaults.
macro_rules! lenient_struct {
    ($name:ident<$lt:lifetime> { $($field:ident : $ty:ty = $key:literal),* $(,)? }) => {
        #[derive(Default)]
        pub struct $name<$lt> { $(pub $field: $ty),* }

        impl<'de> Deserialize<'de> for $name<'de> {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                struct V;
                impl<'de> Visitor<'de> for V {
                    type Value = $name<'de>;
                    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("anything") }
                    fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<$name<'de>, A::Error> {
                        let mut out = $name::default();
                        while let Some(k) = m.next_key::<Cow<'de, str>>()? {
                            match k.as_ref() {
                                $($key => out.$field = m.next_value()?,)*
                                _ => { m.next_value::<IgnoredAny>()?; }
                            }
                        }
                        Ok(out)
                    }
                    fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<$name<'de>, A::Error> {
                        while s.next_element::<IgnoredAny>()?.is_some() {}
                        Ok($name::default())
                    }
                    default_for_the_rest!($name<'de>);
                }
                d.deserialize_any(V)
            }
        }
    };
}

/// An outline vertex.
#[derive(Default)]
pub struct Point { pub x: Num, pub y: Num }

impl<'de> Deserialize<'de> for Point {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Point;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("anything") }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Point, A::Error> {
                let mut out = Point::default();
                while let Some(k) = m.next_key::<Cow<'de, str>>()? {
                    match k.as_ref() {
                        "x" => out.x = m.next_value()?,
                        "y" => out.y = m.next_value()?,
                        _ => { m.next_value::<IgnoredAny>()?; }
                    }
                }
                Ok(out)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Point, A::Error> {
                while s.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Point::default())
            }
            default_for_the_rest!(Point);
        }
        d.deserialize_any(V)
    }
}

lenient_struct!(RoutePoint<'a> {
    route_type: Str<'a> = "route_type",
    x: Num = "x",
    y: Num = "y",
    width: Num = "width",
    layer: Str<'a> = "layer",
    start_pcb_port_id: Str<'a> = "start_pcb_port_id",
    end_pcb_port_id: Str<'a> = "end_pcb_port_id",
});

// One shape for every element type: each type reads the fields it needs.
lenient_struct!(Element<'a> {
    kind: Str<'a> = "type",
    name: Str<'a> = "name",
    // pcb_board
    width: Num = "width",
    height: Num = "height",
    num_layers: Num = "num_layers",
    outline: List<Point> = "outline",
    // source_*
    source_port_id: Str<'a> = "source_port_id",
    source_net_id: Str<'a> = "source_net_id",
    source_trace_id: Str<'a> = "source_trace_id",
    source_component_id: Str<'a> = "source_component_id",
    connected_source_port_ids: List<Str<'a>> = "connected_source_port_ids",
    connected_source_net_ids: List<Str<'a>> = "connected_source_net_ids",
    // pcb_*
    pcb_port_id: Str<'a> = "pcb_port_id",
    pcb_trace_id: Str<'a> = "pcb_trace_id",
    pcb_smtpad_id: Str<'a> = "pcb_smtpad_id",
    route: List<RoutePoint<'a>> = "route",
    connects_to: List<Str<'a>> = "connectsTo",
    connection_name: Str<'a> = "connection_name",
    outer_diameter: Num = "outer_diameter",
    shape: Str<'a> = "shape",
    radius: Num = "radius",
    x: Num = "x",
    y: Num = "y",
    layer: Str<'a> = "layer",
});

/// The top level: Some(elements) for an array, None for any other JSON value.
pub struct Top<'a>(pub Option<Vec<Element<'a>>>);

impl<'de> Deserialize<'de> for Top<'de> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Top<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result { f.write_str("anything") }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Top<'de>, A::Error> {
                let mut out = Vec::with_capacity(s.size_hint().unwrap_or(0));
                while let Some(v) = s.next_element()? { out.push(v); }
                Ok(Top(Some(out)))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Top<'de>, A::Error> {
                while m.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(Top(None))
            }
            fn visit_bool<E: de::Error>(self, _: bool) -> Result<Top<'de>, E> { Ok(Top(None)) }
            fn visit_i64<E: de::Error>(self, _: i64) -> Result<Top<'de>, E> { Ok(Top(None)) }
            fn visit_u64<E: de::Error>(self, _: u64) -> Result<Top<'de>, E> { Ok(Top(None)) }
            fn visit_f64<E: de::Error>(self, _: f64) -> Result<Top<'de>, E> { Ok(Top(None)) }
            fn visit_str<E: de::Error>(self, _: &str) -> Result<Top<'de>, E> { Ok(Top(None)) }
            fn visit_unit<E: de::Error>(self) -> Result<Top<'de>, E> { Ok(Top(None)) }
            fn visit_none<E: de::Error>(self) -> Result<Top<'de>, E> { Ok(Top(None)) }
        }
        d.deserialize_any(V)
    }
}
