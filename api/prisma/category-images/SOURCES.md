# Category tab images

One file per category, named by `legacyCategoryKey(nameEn ?? name)` (see
`src/odoo/odoo-rows.ts`): a `.jpg`/`.jpeg`/`.webp` is the tab image itself, a
`.png` is a logo placed on the dark tile. The sync (`src/odoo/odoo-sync.ts`)
uses them for a category it creates; for categories that already exist run
`node dist/api/src/scripts/category-images.cli.js` (see the file's header).

Photos were cropped where noted, resized to at most 1600 px and re-encoded
(metadata stripped). Pexels and Wikimedia Commons files were taken from the
original uploads; "CC BY-SA 4.0" files require the credit below wherever the
image is republished and derivatives must carry the same licence.

| Category | Key / file | Source | Author · licence |
| --- | --- | --- | --- |
| TANK 300 | `tank300.jpg` (cropped left edge) | [2023 TANK 300 HEV Ultra.jpg](https://commons.wikimedia.org/wiki/File:2023_TANK_300_HEV_Ultra.jpg), Wikimedia Commons | Chanokchon · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| DINZA 8 | `dinza8.jpg` (cropped left edge) | [Denza B8 DMO Nebula Silver 01.jpg](https://commons.wikimedia.org/wiki/File:Denza_B8_DMO_Nebula_Silver_01.jpg), Wikimedia Commons | Ethan Llamas · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| DINZA 5 | `dinza5.jpg` | [Denza B5 MIAS 2026 preview 01.jpg](https://commons.wikimedia.org/wiki/File:Denza_B5_MIAS_2026_preview_01.jpg), Wikimedia Commons | Ethan Llamas · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| PPF | `ppf.jpg` | [Установка антигравийной пленки на капот.jpg](https://commons.wikimedia.org/wiki/File:%D0%A3%D1%81%D1%82%D0%B0%D0%BD%D0%BE%D0%B2%D0%BA%D0%B0_%D0%B0%D0%BD%D1%82%D0%B8%D0%B3%D1%80%D0%B0%D0%B2%D0%B8%D0%B9%D0%BD%D0%BE%D0%B9_%D0%BF%D0%BB%D0%B5%D0%BD%D0%BA%D0%B8_%D0%BD%D0%B0_%D0%BA%D0%B0%D0%BF%D0%BE%D1%82.jpg), Wikimedia Commons | Dmitry757 · [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| PPF SERVICES | `ppfservices.jpg` | [A person wrapping a hood](https://www.pexels.com/photo/a-person-wrapping-a-hood-10126663/), Pexels | Auto Records · [Pexels License](https://www.pexels.com/license/) |
| Window Tinting Services | `windowtintingservices.jpg` | [Man with dreadlocks working by car window](https://www.pexels.com/photo/man-with-dreadlocks-working-by-car-window-20522462/), Pexels | Helena Jankovičová Kováčová · [Pexels License](https://www.pexels.com/license/) |
| Nano Ceramic Coating | `nanoceramiccoating.jpg` | [Water drop, metal and plastic car parts](https://www.pexels.com/photo/water-drop-metal-and-plastic-car-parts-17216297/), Pexels | Adonyi Gábor · [Pexels License](https://www.pexels.com/license/) |
| Rubber Paint | `rubberpaint.jpg` | [Close-up of man painting car details](https://www.pexels.com/photo/close-up-of-man-painting-car-details-14615263/), Pexels | Dextar Studio · [Pexels License](https://www.pexels.com/license/) |
| BLACK EDETION | `blackedetion.jpg` | [A black BMW M3 in a black and white photo](https://www.pexels.com/photo/a-black-bmw-m3-in-a-black-and-white-photo-27968210/), Pexels | Jae Park · [Pexels License](https://www.pexels.com/license/) |
| CAR ACCESSORIES | `caraccessories.jpg` | [A black cellphone holder mounted on a dashboard](https://www.pexels.com/photo/a-black-cellphone-holder-mounted-on-a-dashboard-11334986/), Pexels | Ionel Stanciu · [Pexels License](https://www.pexels.com/license/) |
| Software | `software.jpg` | [Person holding blue diagnostic tool](https://www.pexels.com/photo/person-holding-blue-diagnostic-tool-4116193/), Pexels | Jose Ricardo Barraza Morachis · [Pexels License](https://www.pexels.com/license/) |
| Services | `services.jpg` | [Mechanic fixing a car in a garage](https://www.pexels.com/photo/mechanic-fixing-a-car-in-a-garage-8985604/), Pexels | Artem Podrez · [Pexels License](https://www.pexels.com/license/) |
| WURTH | `wurth.png` (logo; the black wordmark made white for the dark tile) | [Würth Logo 2010.svg](https://commons.wikimedia.org/wiki/File:W%C3%BCrth_Logo_2010.svg), Wikimedia Commons | Würth Group · public domain (text logo, ineligible for copyright); the mark is a registered trademark of the Würth Group |
| THABT | `thabt.png` (logo) | the company's own file | — |

Left as name tiles on purpose: `OTHER CAR`. `Xiaomi Accessories` and
`Tesla Accessories` already carry car cut-outs and were not changed.
