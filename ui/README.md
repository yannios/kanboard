# Kanban UI — moderni frontend na Kanboardovom API-ju

Ovaj folder je **vlastito sučelje** (Kaneo/Linear stil) koje ne dira Kanboard —
sve što prikazuje dolazi iz Kanboarda preko njegovog JSON-RPC API-ja, a svaka
promjena (novi zadatak, prebacivanje kartice, opis, podzadatak, komentar) ide
natrag u Kanboard.

## Kako otvoriti

- Lokalno (Laragon): <http://localhost/kanban/ui/index.html>
- Na hostingu: uploadaj folder `ui/` unutar Kanboardove mape i otvori
  `https://tvojdomena/kanban/ui/index.html`

Bez build koraka, bez Nodea. Tri datoteke: `index.html`, `app.css`, `app.js`.

## Povezivanje (API token)

Prvi put klikni **Povezivanje** (dno sidebara) i upiši:

- **Korisnik** — tvoje Kanboard korisničko ime
- **API token** — iz Kanboarda: *Moj profil → API pristup → Generiraj token*

Token se pamti u pregledniku (localStorage), ne u datoteci. Ako želiš prekinuti
pristup, u Kanboardu regeneriraj token — stari odmah prestaje raditi.

## Veličina teksta

Na dnu sidebara je izbornik **Veličina teksta** (`Aa` × 4: 13 / 14,5 / 16 / 17,5 px).
Cijelo sučelje je u `rem` jedinicama, pa se jednim klikom skaliraju i fontovi i
razmaci i širine kolona. Odabir se pamti u pregledniku.

## Mobitel

Sučelje je prilagođeno za telefon (testirano na 390 px širine):

- sidebar se otvara hamburgerom (☰) i zatvara klikom izvan njega
- kolone se „lijepe" jedna po jedna dok listaš prstom (scroll-snap)
- detalj zadatka je preko cijelog ekrana, svojstva su iznad teksta
- svi gumbi su najmanje ~38 px za prst

## Prečaci na tipkovnici

| Tipka | Akcija |
|---|---|
| `/` | skoči u pretragu |
| `1`–`4` | Zadaci / Lista / Zaostali / Kalendar |
| `n` | novi zadatak u prvoj koloni |
| `t` | tamna / svijetla tema |
| `Esc` | zatvori zadatak, izbornik ili sidebar |

## Što radi

- **Ploča**: kolone iz Kanboarda, kartice s ID-em (npr. `KUCA-1`), rokom
  (crveno kad je probijen, žuto kad gori), brojem podzadataka, prioritetom i
  oznakama (Kanboardove kategorije)
- **Povlačenje kartica** između kolona (sprema se u Kanboard)
- **Novi zadatak** gumbom `+` u koloni (Enter sprema)
- **Detalj zadatka**: naslov, opis, podzadaci s kvačicama, komentari, te
  svojstva desno (status, prioritet, datum, kategorija, boja)
- **Lista** i **Zaostali** pregled
- **Pretraga** i **sortiranje** (po datumu / prioritetu)
- **Tamna i svijetla tema** (prekidač na dnu sidebara, ili tipka `t`)
- **Kalendar** — mjesečni prikaz zadataka po roku, s navigacijom po mjesecima
- **Privici** — dodavanje, preuzimanje i brisanje datoteka na zadatku
- **Dodjela zadatka** i **odabir kategorije/prioriteta/boje** preko padajućih izbornika

## Što još nije napravljeno

- Kalendar/Gantt pregled
- Dodavanje/brisanje projekata (radi se u Kanboardu)
- Dodavanje kolona, privitaka, ovisnosti zadataka
- Korisnici: prikaz "Moji zadaci" filtrira samo po dodijeljenima
