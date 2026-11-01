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
  boitata: { color: "Boitatá no Parque Farroupilha 3.jpg" },
  curupira: { color: "Curupira.png" },
  lobizon: { color: "Luisón - Museo Ramón Elías 08-05-2022.jpg" },
  camahueto: { color: "Camahueto A74067320240105.jpg" },
  sphinx: { color: "028MAD Sphinx.jpg" },
  "mokele-mbembe": { bw: "Brontosaurus (PSF).jpg", color: "Pasta-Brontosaurus.jpg" },
  "emela-ntouka": { color: "Emela-ntouka.png" },
  kongamato: { color: "Kongamato.png" },
  grootslang: { color: "Grootslang.jpg" },
  kelpie: { bw: "Line drawing of Maiden Stone east side (cropped).jpg", color: "Globe fountain detail - geograph.org.uk - 894643.jpg" },
  nessie: { bw: "Arthur Grant loch ness sketch.png", color: "Lochneska poboba museumofnessie.jpg" },
  puca: { bw: "Colum-KOIS(Holt1916)-Pogany-illustr-p283-the-pooka-and-horse.jpg" },
  "red-dragon": { color: "800x480-Y Ddraig Goch.png" },
  afanc: { bw: "The Beaver, engraving.jpg" },
  "black-shuck": { bw: "A Staunge and terrible Wunder.jpg", color: "Black Dog by Vasilios Markousis 2015.jpg" },
  "lambton-worm": { bw: "Lambton Worm.jpg", color: "The Lambton Worm at the Gateshead Garden Festival - geograph.org.uk - 2264349.jpg" },
  troll: { bw: "Witch and troll by John Bauer 1909.jpg", color: "John Bauer 1915.jpg" },
  "yule-cat": { color: "Yule Cat illustration.jpg" },
  wolpertinger: { bw: "Wolpertinger 1836.jpg", color: "Wolpertinger.jpg" },
  tatzelwurm: { bw: "Scheuchzer(1723)-vol2-p378a-catheaded-serpent.jpg" },
  tarasque: { bw: "CP Tarasque de Tarascon.jpg", color: "Dessin de Conrad Mouren.jpg" },
  gevaudan: { bw: "Gevaudanwolf.jpg", color: "Dessin de la bête du Gévaudan 1765 - Archives départementales de l’Hérault - FRAD034-C440002-00001.jpg" },
  hydra: { color: "Mosaico Trabajos Hércules (M.A.N. Madrid) 02.jpg" },
  minotaur: { bw: "DVinfernoMinotaurOnCliff m.jpg", color: "Blake Dante Hell XII.jpg" },
  chimera: { color: "Chimera Apulia Louvre K362.jpg" },
  zmey: { color: "Dobrynya Nikitich rescues Zabava from the Gorynych, 1941.jpg" },
  leshy: { bw: "Ill dict infernal p0419 lechies.jpg", color: "Leshiy by Vasnetsov.jpg" },
  kappa: { bw: "Hokusai kappa.jpg", color: "Kappa water imp 1836.jpg" },
  kyubi: { bw: "NineTailsFox.JPG", color: "MET DP138369.jpg" },
  oni: { bw: "SekienOni.jpg", color: "Kyosai Oni in priest's robes.jpg" },
  nue: { bw: "SekienNue.jpg", color: "Kuniyoshi Taiba (The End).jpg" },
  tengu: { bw: "SekienTengu.jpg", color: "Hokusai tengu 2.jpg" },
  raiju: { bw: "Gendo-Hogen Raiju.jpg", color: "ShunsenKaminari.jpg" },
  tanuki: { bw: "SekienTanuki.jpg", color: "Tanuki or Racoon dog. Banna-ji. Ashikaga, Tochigi.jpg" },
  "ushi-oni": { bw: "SekienUshioni.jpg", color: "Suushi Ushioni.jpg" },
  dokkaebi: { color: "산수귀문전.jpg" },
  qilin: { bw: "Qilin in sancai tuhui.jpg", color: "MET DP227291.jpg" },
  yeti: { bw: "Eric Shipton yeti footprint.png", color: "Yeti colorisé.jpg" },
  "olgoi-khorkhoi": { color: "Allghoikhorkhoi.jpg" },
  manticore: { bw: "ManticoraTHoFFB1607.png", color: "Manticore - British Library Royal 12 F xiii f24v (detail).jpg" },
  roc: { bw: "Roc8954.jpg", color: "Edward Julius Detmold49.jpg" },
  tikbalang: { color: "Tikbalang The Philippine Demon Horse Commons.jpg" },
  bunyip: { bw: "Bunyip 1890.jpg" },
  ropen: { color: "Ropen (cryptid pterosaur).png" },
  snallygaster: { bw: "Snallygaster-image.png" },
  "flatwoods-monster": { color: "Flatwoods monster.png" },
  splintercat: { bw: "Slinter cat.jpg" },
  "fur-bearing-trout": { color: "Fur-Covered Trout.jpg" },
  "loveland-frogman": { bw: "Loveland Frog.png", color: "Loveland frog.png" },
  "lizard-man": { bw: "Lizard Man of Scape ore Swamp.jpg" },
  "drop-bear": { color: "Dropbear.jpg" },
  "hoop-snake": { bw: "Hoop snake.jpg" },
  "dover-demon": { color: "Dover Demon.png" },
};

/** Who made a picture, where Commons names the uploader or scanner instead. */
export const CREDIT: Record<string, string> = {
  "DVinfernoMinotaurOnCliff m.jpg": "Gustave Doré",
  "Wolpertinger 1836.jpg": "Anonymous, 1836",
  "Roc8954.jpg": "Unknown",
};

/** One saved picture: where the page finds it, its Commons page, and the credit its licence asks for. */
export const Pic = obj({
  src: str(200, { re: /^art\/[a-z0-9-]+\.jpg$/ }),
  page: str(400, { re: /^https:\/\/(commons\.wikimedia\.org\/|github\.com\/QuinnsCode\/RustyBuns\/)/ }),
  artist: str(200),
  license: str(60),
  licenseUrl: opt(str(300)),
});
export type Pic = Of<typeof Pic>;
/** art.json: each beast's saved sides. */
export const Art = rec(obj({ bw: opt(Pic), color: opt(Pic) }), 256);
export type Art = Of<typeof Art>;
