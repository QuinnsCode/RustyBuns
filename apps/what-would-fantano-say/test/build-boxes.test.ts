import { describe, expect, test } from "bun:test";
import { boxFor, parseCsv, parseReviews, summarize, takeFrom, transcriptName, type Album } from "../scripts/build-boxes.ts";

describe("build-boxes", () => {
  test("reads quoted CSV fields", () => {
    const csv = 'publishedAt,artist,title,rating,genres\n2023-03-21T04:44:29Z,100 gecs,"10,000 gecs",8,alternative rock;;hyperpop\n2023-01-01T00:00:00Z,"Say ""Hi""",X,not a score,pop\n';
    expect(parseCsv(csv)[1]).toEqual(["2023-03-21T04:44:29Z", "100 gecs", "10,000 gecs", "8", "alternative rock;;hyperpop"]);
    expect(parseReviews(csv)).toEqual([{ artist: "100 gecs", title: "10,000 gecs", year: 2023, score: 8, genres: ["alternative rock", "hyperpop"] }]);
  });

  test("an album goes in the box of its first genre that matches", () => {
    expect(boxFor(["industrial hip hop", "trap"])).toBe("abrasive-rap");
    expect(boxFor(["jazz rap"])).toBe("conscious-rap");
    expect(boxFor(["trap rap"])).toBe("streaming-rap");
    expect(boxFor(["pop punk"])).toBe("dad-rock");
    expect(boxFor(["electropop"])).toBe("radio-pop");
    expect(boxFor(["look at the album cover", "drone"])).toBe("ambient");
    expect(boxFor(["freak salsa"])).toBeUndefined();
  });

  test("the take is what he says right before the score", () => {
    const punctuated = "Hi everyone. Lots of words here. Overall, the hooks are huge and the writing is sharper than ever. I'm feeling a strong 8 on this one. Transition!";
    expect(takeFrom(punctuated)).toBe("The hooks are huge and the writing is sharper than ever.");
    const captions = "hi everyone fantano here and this record " + "word ".repeat(30) + "the production just never lands for me i'm feeling a light 4";
    expect(takeFrom(captions)!.split(" ")).toHaveLength(24);
    expect(takeFrom(captions)).toEndWith("never lands for me");
    expect(takeFrom("no score anywhere in this one")).toBeUndefined();
    expect(takeFrom("x ".repeat(200) + "I'm feeling a 7")!.length).toBeLessThanOrEqual(160);
  });

  test("transcript names are file-system safe", () => {
    expect(transcriptName({ artist: "AC/DC", title: "What?" })).toBe("ACDC - What.txt");
  });

  test("summaries: the middle half of the scores, the most-reviewed artists, one example per score", () => {
    const a = (artist: string, score: number, year = 2020, take?: string): Album => ({ artist, title: `${artist} ${score}`, year, score, genres: [], ...(take && { take }) });
    const s = summarize([a("A", 3), a("A", 7), a("B", 7, 2022), a("B", 7, 2019, "said something"), a("A", 8), a("C", 9)]);
    expect(s).toMatchObject({ reviews: 6, median: 7, scores: [7, 8], soundsLike: ["A", "B", "C"] });
    expect(s.examples.map((e) => e.score)).toEqual([3, 7, 8, 9]);
    expect(s.examples[1]!.take).toBe("said something");
  });
});
