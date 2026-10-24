// The six regions the park pickers group the 63 national parks into, by the state a park is in (the first
// one, where a park spans several). Shared by Skate Tech Park's picker and Park Hide & Seek's lobby.

export const REGIONS = ["West Coast", "Southwest", "Rockies", "Plains & Midwest", "East & Florida", "Alaska & Islands"] as const;
export type Region = (typeof REGIONS)[number];

const BY_STATE: Record<string, Region> = {
  CA: "West Coast", OR: "West Coast", WA: "West Coast",
  AZ: "Southwest", NM: "Southwest", UT: "Southwest", NV: "Southwest", TX: "Southwest",
  CO: "Rockies", WY: "Rockies", MT: "Rockies",
  SD: "Plains & Midwest", ND: "Plains & Midwest", MO: "Plains & Midwest", AR: "Plains & Midwest", IN: "Plains & Midwest", OH: "Plains & Midwest", MI: "Plains & Midwest", MN: "Plains & Midwest",
  ME: "East & Florida", VA: "East & Florida", WV: "East & Florida", TN: "East & Florida", KY: "East & Florida", SC: "East & Florida", FL: "East & Florida",
  AK: "Alaska & Islands", HI: "Alaska & Islands", AS: "Alaska & Islands", VI: "Alaska & Islands",
};
export const regionOf = (state: string): Region => BY_STATE[state] ?? "West Coast";
