// The pictures on each beast's card: a black-and-white drawing and a colour one, hand-picked from Wikimedia
// Commons (public domain or a CC licence that lets us show it with credit). This file is the pick, a Commons
// file title per side; `bun scripts/fetch-art.ts` reads each one's artist and licence from Commons, saves a
// 480 px copy to public/art/ and writes both into art.json, which the card reads. A side with no good open
// picture yet is left out, and the card shows the side it has.
import { obj, opt, rec, str, type Of } from "@rustybuns/util/guard";

export interface Pick { bw?: string; color?: string }

export const PICKS: Record<string, Pick> = {
  "jersey-devil": { bw: "Jersey Devil Philadelphia Post 1909.jpg", color: "Jersey devil mini.jpg" },
  mothman: { bw: "Mothman Roger Scarberry Sketch.jpg", color: "Mothman Artist's Impression.png" },
  "wampus-cat": { bw: "Wampus cat.jpg", color: "Wampus cat 20160530 123904 (cropped).jpg" },
  hodag: { bw: "The Hodag.png", color: "Hodag 002.jpg" },
  squonk: { bw: "Squonk.jpg" },
  hidebehind: { bw: "Hidebehind.jpg" },
  agropelter: { bw: "Agropelter.jpg" },
  sasquatch: { bw: "Pie Grande.jpg", color: "Murphy the Bigfoot.jpg" },
  champ: { bw: "Artistic representation of Sandra Mansi's 1977 photograph of \"Champ\" lake monster.jpg", color: "Mansi Photograph (cropped).jpg" },
  chupacabra: { bw: "Chupacabra padayachee.jpg", color: "Chupacabras.svg" },
  jackalope: { bw: "Lepus cornutus.jpg", color: "Animalia Qvadrvpedia et Reptilia (Terra) Plate XLVII.jpg" },
  rougarou: { bw: "Loup-garou dessiné par Henri Julien.png", color: "Rougarou.jpg" },
  "ozark-howler": { bw: "Ozark Howler drawing.jpg", color: "Ozark Howler Watercolor Painting.jpg" },
  ahuizotl: { bw: "Chimalli Ahuizotl Weltmuseum Vienna sketch.png", color: "Ahuitzotl.jpg" },
  cadejo: { bw: "Cadejo.JPG", color: "El Cadejo - \"La Linea\" by Carlos Loarca.jpg" },
  mapinguari: { color: "MAPINGUARI (cropped).png" },
};

/** One saved picture: where the page finds it, its Commons page, and the credit its licence asks for. */
export const Pic = obj({
  src: str(200, { re: /^art\/[a-z0-9-]+\.jpg$/ }),
  page: str(400, { re: /^https:\/\/commons\.wikimedia\.org\// }),
  artist: str(200),
  license: str(60),
  licenseUrl: opt(str(300)),
});
export type Pic = Of<typeof Pic>;
/** art.json: each beast's saved sides. */
export const Art = rec(obj({ bw: opt(Pic), color: opt(Pic) }), 256);
export type Art = Of<typeof Art>;
