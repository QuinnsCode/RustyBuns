# A venue from photos (#5994)

A Qevent party's **Venue** takes a ShareSplat link. This is how to make one from photos instead of a walk round the place.

## Train it

```
cd apps/sharesplat
bun trainer/venue.ts <photo-folder>     # writes <photo-folder>-splat/splat.ply
```

It needs [COLMAP](https://colmap.github.io/) (`brew install colmap`), `brush` from
[Brush v0.3.0](https://github.com/ArthurBrussee/brush/releases) on `PATH`, a GPU, and at least 20 overlapping `.jpg`
or `.png` photos (60 or more is better). Leave out photos with people in them. Neither tool has been run through
this script on real photos yet: its test uses stand-ins.

Then open `splat.ply` in ShareSplat, **do not press the scissors** (they cut a product off its table), press the cloud,
and paste the link into the party's Venue. The upload limit is 50 MB.

## Where the photos may come from

The script fetches nothing. Use photos you took (with the venue's permission) or that their licence lets you publish a
model from. Adding code that fetches from any source is the owner's decision first.

Terms as read on 2026-11-28. Read them again before relying on a row; this is not legal advice.

| Source | Publish a splat made from its photos? |
|---|---|
| [Google Maps, Places, Street View](https://cloud.google.com/maps-platform/terms) | **No.** 3.2.3: no creating content from Maps content, no scraping |
| [Yelp](https://terms.yelp.com/developers/api_terms/20260922_en_us/) | **No.** No scraping or derivative works; API data kept 24 hours at most |
| [Tripadvisor](https://tripadvisor.mediaroom.com/us-terms-of-use) | **No.** No automated access or derivative works |
| [Foursquare](https://foursquare.com/legal/terms/apilicenseagreement/) | **No.** The licence gives no right to make derivative works |
| [Wikimedia Commons](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) | Per file: credit the author; BY-SA files likely make the splat BY-SA. Follow its [User-Agent](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy) and rate rules |
| [Openverse](https://docs.openverse.org/terms_of_service.html) | Per image, and you check the licence yourself. No scraping |
| [Flickr](https://www.flickr.com/help/terms/api) | Only photos licensed CC0, CC BY or BY-SA, through the API; limits on keeping copies |
| [Mapillary](https://www.mapillary.com/terms) | CC BY-SA with their logo and a link; some sets are non-commercial. Street level |
| [KartaView](https://kartaview.org/terms) | CC BY-SA, credit "© Grab and KartaView Contributors". Street level |
| [Panoramax](https://docs.panoramax.fr/federated-catalog/) | CC BY-SA or Licence Ouverte, per item. Street level |

A copyright licence doesn't cover people in the picture, artwork on the walls or the venue's own rules. ShareSplat's
page shows no credit line, so a splat that needs one has to be credited wherever it is shown.

## Free sets of a museum or heritage site

No dense, openly licensed set of a museum or historic **interior** turned up (not an exhaustive search): the good
interior sets are non-commercial or state no licence. These exteriors would do for a test:

| Set | Photos | Licence |
|---|---|---|
| [Heritage3DMtl](https://zenodo.org/records/17063337), Montreal buildings from a drone (`2-Resurrection-Chapel.zip`, 1.7 GB) | 272 | CC BY 4.0 |
| [Great Temple, Sarmizegetusa](https://zenodo.org/records/23912392), ruins (about 8 GB) | 1,155 aligned | CC BY 4.0 |
| [Rigomagno](https://zenodo.org/records/16575949), a square in Italy | 314 | CC BY 4.0 |
