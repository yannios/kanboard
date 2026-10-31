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

## Swimlanes (staze)

Ako projekt u Kanboardu ima **više staza**, ploča ih prikazuje kao odvojene
redove s naslovom staze i brojem zadataka; svaka se može sklopiti (▾/▸, stanje
se pamti). Kod projekta s jednom stazom (uobičajeno) nema zaglavlja — ploča
izgleda isto kao i prije.

## Filtri i masovne akcije

- **Filtri** (gumb u traci): dodijeljeno, kategorija, prioritet, rok
  (probijeno / danas / ovaj tjedan / bez roka) + sortiranje. Aktivni filtri se
  broje na gumbu; „Očisti filtre" resetira sve. Filtri vrijede za ploču, listu i kalendar.
- **Moji zadaci** (sidebar): prikazuje samo zadatke dodijeljene tebi.
- **Masovne akcije**: gumb ▣ uključi način odabira — kartice dobiju kvačice,
  dolje se pojavi traka s brojem odabranih i akcijama *Premjesti u kolonu*,
  *Dodijeli korisniku*, *Obriši*.

## Prijava

UI se prijavljuje **korisničkim imenom i lozinkom sa Kanboard računa** — dvije male
PHP točke rade taj posao:

- `login.php` — provjerava lozinku **Kanboardovim vlastitim validatorom**
  (`authValidator`), pa vrijede ista pravila kao za klasičnu prijavu: neaktivni,
  LDAP i računi bez obrasca ne mogu se prijaviti, broje se promašaji, račun se
  zaključava nakon `BRUTEFORCE_LOCKDOWN` pokušaja i traži captcha nakon
  `BRUTEFORCE_CAPTCHA`. Na uspjeh sprema korisnika i njegov API token u sesiju.
- `proxy.php` — prima JSON-RPC pozive iz preglednika i izvršava ih u ime
  prijavljenog korisnika. **Token nikad ne ide u preglednik**, a poziv se izvršava
  unutar istog PHP procesa (bez HTTP poziva na samog sebe, pa nema mrtve blokade
  na jednoprocesnim postavkama). Zahtijeva `X-KBUI: 1` i `application/json`, što
  onemogućuje CSRF s druge domene.

Sesija je Kanboardova (`KB_SID`, spremnik u bazi). **Odjava** je u sidebaru.
Računi s uključenom dvofaktorskom zaštitom ne mogu se prijaviti kroz UI (poruka
ih uputi na token).

### Način s API tokenom (bez PHP-a)

Ako se `login.php` ne može dohvatiti (npr. UI se poslužuje sa statičnog hostera),
UI se sam prebaci na stari način: **Napredno: API token** u prijavnom obrascu,
token iz *Moj profil → API pristup*. Tada token stoji u `localStorage` preglednika.

## Svi zadaci (agregat)

Stavka **Svi zadaci** u sidebaru spaja sve projekte u jednu listu, grupiranu po
projektu (kod projekta, naziv, broj zadataka). Redak prikazuje kolonu, rok i
kategoriju; klik **prebaci na taj projekt i otvori zadatak**. Filtri i pretraga
vrijede i ovdje, a **Izvezi CSV** sprema trenutni prikaz (sve projekte ili samo
otvoreni) — `;` kao separator i BOM, da Excel otvori čitljivo.

## Ispis / PDF

Gumb ⎙ (ili `P`, ili Ctrl+P) otvara ispis. Stilovi za ispis skrivaju sidebar,
traku, gumbe i ladice; ploča, lista, agregat i vremenska crta ispisuju se na
bijelom s prelomima po kolonama.

## Prava (samo gledanje)

Kanboard ne vraća ulogu korisnika na projektu kroz JSON-RPC (`getProjectUsers`
daje samo imena), pa UI pravo provjeri jednim bezopasnim upisom iste vrijednosti:
ako Kanboard odgovori `403 Forbidden`, sučelje prelazi u **samo gledanje** —
crvena traka, bez gumba `+`, bez masovnih akcija, bez povlačenja kartica i bez
akcija u kartici zadatka.

> Napomena: `getAllProjects` je dopušten samo `app-adminu`; UI zato koristi
> `getMyProjects` (uz zalihu na `getAllProjects`), inače bi običan korisnik dobio
> prazan ekran.

## Vremenska crta (Gantt)

Tab **Vremenska crta** prikazuje zadatke kao trake: početak je `date_started`
(ili datum kreiranja), kraj je `date_due`; zadaci su grupirani po koloni, danas
je označeno linijom, a prekoračen rok dobiva crveni obrub. Zumiranje (−/+) mijenja
širinu dana (14–64 px), „Danas" skrola na današnji datum.

## Vezani zadaci

U kartici zadatka, sekcija **Vezani zadaci**: `+` → odaberi tip veze (relates to,
blocks, duplicates, …) → odaberi zadatak. Veza se stvara preko `createTaskLink`;
✕ uklanja vezu (`removeTaskLink`, parametar je `task_link_id`).

## Spominjanja u komentarima

U polju za komentar upiši `@` — iskoči popis članova projekta; odabir ubaci
`@korisnicko_ime ` (Kanboard tako šalje obavijest spomenutom).

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
