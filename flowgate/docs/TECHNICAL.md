# FlowGate: technical reference

The plain-language install guide is `SETUP.md`. This file is the detail behind it: what is tested,
how the parts fit together, where every assumption lives, and how to hand the project on.

---

## 1. What is in the box, and what is actually tested

| Part | Where | Needs | Status |
|---|---|---|---|
| Web app and API (student, gate, control room, signage) | `server.js`, `src/`, `public/` | Node.js 22.13+. No `npm install`, no internet. | Tested on macOS, Node 24 |
| Slot optimizer and peak-hour simulator | `src/optimizer.js`, `src/simulator.js` | Same | Tested |
| Hands-free plate entry | `POST /api/gate/plate` | Same | Tested with simulated reads only |
| AI copilot (Claude) | `src/copilot.js` | `npm install` + Anthropic API key + internet | **Never run with a real key.** Offline rules are tested and are the automatic fallback. |
| Camera counter (YOLOv8 + ByteTrack) | `yolo/counter.py` | Python 3.10 to 3.12, ~2 GB of libraries, a video | **Run for real** on our own gate footage, 13 Nov 2026 |
| **Measured gate data** | `docs/measured/` | Nothing, it is results | **Real.** The only non-assumed figures in the project |
| Fake camera stand-in | `yolo/fake_camera.py` | Python 3, no extra packages | Tested |
| Setup checker | `scripts/doctor.js` | Node.js | Tested |
| Pitch deck | claude.ai artifact (section 6), sources in `docs/deck/` | A browser | Done |

**Tested on macOS with Node 24 only**, including a clean-folder handover test: zip, unzip, doctor,
start, every page and library returning 200, with no `node_modules` present. The Windows and Linux
instructions follow standard practice but **were not run on those systems**, and the "Node too old"
message was never triggered on an old Node. Run `node scripts/doctor.js` first on any new machine.

**The raw video is not in this folder.** The three 4K clips are about 1.9 GB and live outside the
project. Everything derived from them is in `docs/measured/`.

---

## 2. Running options

**Different port**, if 4000 is busy:

macOS and Linux:
```bash
PORT=4100 node server.js
```

Windows PowerShell:
```powershell
$env:PORT=4100; node server.js
```

**Demo clock.** The control room has a "Demo clock" box, default `08:25`. Gate scans compare the
arrival time against this clock, so scans read "on time" during a demo at any hour of the day.
Clear the box to use the real clock.

**Phone access.** The server prints a LAN address on start. The phone must be on the same Wi-Fi.
macOS asks to accept incoming connections: click Allow. Windows Defender asks: allow on Private
networks. Campus Wi-Fi often blocks device-to-device traffic, so a laptop hotspot is the reliable
fallback.

**Camera QR scanning** works on `localhost` only. Browsers refuse camera access over plain `http://`
on a LAN address, so a phone opening the gate page that way cannot scan. Use the typed code or the
**Scan in** button. If you genuinely need phone-camera scanning, put the app behind an HTTPS tunnel
(for example `cloudflared tunnel --url http://localhost:4000`). That exposes the app to anyone with
the link, so only do it with demo data.

---

## 3. Optional: the AI copilot

Without a key the copilot answers from built-in rules. With one, answers come from Claude
(`claude-opus-5-5` by default).

```bash
npm install
```

Get a key from https://console.anthropic.com (Settings, API keys). Usage is billed to that account.
Set it in the **same** window you start the server from. **Never paste a key into a file in this
project.**

macOS and Linux:
```bash
export ANTHROPIC_API_KEY="your-key-here"
```

Windows PowerShell:
```powershell
$env:ANTHROPIC_API_KEY="your-key-here"
```

Then start the server and check the copilot badge in the control room says **Claude**, not
**Offline rules**. Or open `http://localhost:4000/api/copilot/status`.

- Use a cheaper model with `FLOWGATE_MODEL`, for example `claude-sonnet-5-5`, set the same way.
- Only aggregate numbers are sent: zone counts, gate queues, alerts, department totals. Never names,
  USNs or plates.
- A bad key or no internet falls back to offline answers and shows the reason under the answer.
- **This path has never been tested with a real key.** Test it before the demo.

---

## 4. Optional: counting vehicles from video

We have run this for real. The results, method and limits are in `docs/measured/`.

Python 3.10, 3.11 or 3.12. PyTorch support for newer versions lags.

macOS and Linux:
```bash
cd yolo
```
```bash
python3 -m venv .venv
```
```bash
.venv/bin/python -m pip install -r requirements.txt
```
```bash
.venv/bin/python counter.py --source gate.mp4 --gate G1 --show
```

Windows PowerShell: same, but `py -3 -m venv .venv` and `.venv\Scripts\python`.

- First run downloads PyTorch (large) and `yolov8n.pt` (about 6 MB). Do this on good internet, not
  at the venue.
- `--source 0` uses the webcam; an `rtsp://...` URL reads a CCTV stream.
- `--line 0.6` sets the counting line as a fraction of frame height; `--invert` swaps in and out.
- The FlowGate server must be running. Counts go to `POST /api/counts`.

The richer script used for the real measurement, which counts per minute and records every
individual crossing, is `docs/measured/measure.py`.

**Fake camera**, no machine learning, standard Python only:
```bash
python3 yolo/fake_camera.py --gate G1 --rate 2
```
It posts with `source: "simulated"`, so the dashboard labels it **Simulated feed**, not a camera.

---

## 5. Where the assumptions live

| What | File | Notes |
|---|---|---|
| Gates, throughput per minute, map positions | `src/config.js` → `GATES` | `capacityPerMin` drives every queue result |
| Parking zones and capacities | `src/config.js` → `ZONES` | |
| Departments, years, headcounts, class times | `src/config.js` → `buildCohorts()` | Or paste a timetable CSV into Control Room → Slot Optimizer → Apply |
| Mode share, faculty, buses | `src/config.js` | |
| Normal and stress day | `src/simulator.js` → `DAYS`, `RAIN` | |
| Marshal lane and forecast thresholds | `src/simulator.js` → `MARSHAL`, `PREDICT` | |
| Demo people and plates | `src/db.js` → `seed()` | All fictional. Plates use `KA 00`, not a real RTO code. To add or import real people, use **Control Room → People** rather than editing this; anyone added there is kept across a reset (`users.added = 1`). A person belongs to one of the six `INSTITUTIONS` (`users.institution`). Only `RNSIT` people get an optimised slot; everyone else inherits their institution's fixed bell via `userWindow()`. |

After changing any of these, restart with `node server.js --reset`.

**Two traps worth knowing:**

1. **Cohorts and the schedule are stored in the database**, not read fresh from `config.js`. Editing
   headcounts or class times does nothing until you run `node server.js --reset` or press Apply in
   the Slot Optimizer. Gate and zone capacities are read directly, so a plain restart is enough.
2. **Some assumptions are not in the named constants.** The arrival curve (`firstClass - 8`, sd 5)
   is written twice, in `simulator.js` and `optimizer.js`; change one and the optimizer chart stops
   matching the simulator. The "75% use the Main Gate" habit, the 0.7 carpool factor and the
   pedestrian weightings are inline numbers further down `simulator.js`.

### The frozen numbers in the documents

The web pages recalculate themselves. **The deck and the written documents do not.** Every figure
below is typed prose that a human must edit, and several appear in ten or more places:

Checked against a live run on 13 November 2026, seed 42. To re-check, start the server and read
`/api/sim/compare?day=normal`, `?day=stress` and `/api/optimizer`.

| Figure | Means |
|---|---|
| `53`, `35`, `47` | peak arrivals a minute; what the one gate clears today; with a two-wheeler lane |
| `8,900` | people arriving on this campus across all six institutions |
| `5,520`, `720` | RNSIT undergraduates (AICTE intake x 4 years) and MBA + MCA |
| `1,200`, `480`, `1,018` | RNS International School, RNS PU College, RNS First Grade College |
| `08:00`, `08:45`, `08:30`, `09:00` | start times: school seniors, school juniors, PU college, engineering |
| `311`, `8.9`, `41` | normal day today: peak queue, worst wait, minutes spilling onto the road |
| `3`, `0.5`, `0` | normal day with FlowGate |
| `919`, `32.8`, `56` | stress day today |
| `196`, `7.1`, `28` | stress day, FlowGate reactive |
| `56`, `2.0`, `11` | stress day, FlowGate + Predict |
| `08:19`, `08:15` | marshal sent: reactive, then predictive |
| `147`, `82%`, `33`, `1.8` | measured at our own gate: vehicles, two-wheeler share, busiest minute, seconds apart |
| `26%`, `5.7%`, `30%` | mode share: two-wheeler, car, bus (two-wheeler share of vehicles stays 82%) |


Search **all** of these: `README.md`, `docs/ABSTRACT.md`, `docs/DEMO_SCRIPT.md`, `docs/SETUP.md`,
this file, every `docs/deck/slides/*.html` (body text, image `alt` text **and** the `<aside>`
speaker notes), and the `.pptx`. The screenshots in `docs/screenshots/` have numbers baked into the
pixels. Re-capture them rather than editing: start the server, then run the capture script in the
video scratchpad (`shots.js`), or take them by hand at 1440x900. They were last re-captured on
13 Nov 2026, after the move to one gate and the RNSIT colours.

**Do not blind find-and-replace.** Figures collide with unrelated values: `35` is the gate capacity
*and* nothing else, while `22` is the bus fleet and `24` the Node version; `40` is a zone capacity *and* the spillback
threshold *and* an SQL limit; `150` is a zone capacity *and* the green-credits threshold.

**One figure needs care above all others.** There are three different "vehicles per minute" and they
are not interchangeable:

1. `53` a minute, modelled, every institution on campus arriving at the peak.
2. `35` a minute, what the one vehicle gate clears today as a single mixed queue. `47` is the same gate with a dedicated two-wheeler lane, which is the only capacity available without building anything.
3. `33` a minute, measured, what we actually counted passing the Main Gate alone in its busiest
   minute on 13 November, while traffic was still flowing freely. This is one gate, one morning,
   and it is a floor on that gate's capacity, not a ceiling.

Say which one you mean every time. The whole argument rests on the gap between 1 and 2: far more
arrives than one gate can clear, and six institutions start within the same hour.

---

## 6. How it fits together

```
Browser pages (public/)                     Server (server.js, plain Node http)
  student.html  --REST-->  /api/me, /api/bookings, /api/carpool/*, /api/credits
  gate.html     --REST-->  /api/gate/scan, /api/gate/plate, /api/passes, /api/plates
  admin.html    --REST-->  /api/optimizer/*, /api/sim/*, /api/copilot, /api/admin/*
  sign.html     <--SSE---  /api/stream  (events: live, sim, scan, notice, schedule)
                                     |
                     src/db.js         SQLite file data/flowgate.db: users, bookings,
                                       carpools, events, credits, settings
                     src/optimizer.js  timetable to staggered slots
                     src/simulator.js  minute-by-minute peak model + forecast controller
                     src/copilot.js    Claude API if available, else offline rules
yolo/counter.py and fake_camera.py --POST /api/counts--> server
```

Every page updates over Server-Sent Events, so nothing needs refreshing. The simulator runs on the
server, so every open screen sees the same simulated morning. The full API table is in `README.md`.

---

## 7. The pitch deck

- Live deck: https://claude.ai/artifact/4cTm2bF8KoYtxJXWrvUnrL
- It is **private** and belongs to the original owner's account. To hand it over, the owner opens it,
  uses **Share** to give access, and **Export** to download a PPTX or PDF.
- Slide sources (one HTML file per slide, plus shared CSS) are copied into `docs/deck/` so the
  content survives even if access does not.
- The `.pptx` currently in `docs/` is named `OLD-...` because it predates the measured-data slide.
  Re-export before presenting.
- Fill in the placeholders: `[Team name]`, `[Member 1, ...]`, `[Hackathon name]`, `[Email or GitHub link]`.

---

## 8. Handing the project on

**Do not rely on drag-and-drop sync tools** that silently skip folders. An earlier move dropped a
folder of browser libraries, which is why they now live in `public/lib/`. After any copy, run
`node scripts/doctor.js`; it checks for exactly that.

**Zip.** Leave out the generated folders:

```bash
zip -r flowgate.zip flowgate -x "flowgate/node_modules/*" "flowgate/data/*" "flowgate/yolo/.venv/*" "flowgate/yolo/*.pt"
```

On Windows, delete `node_modules`, `data` and `yolo\.venv` first, then right-click the folder and
choose **Compress to ZIP file**.

**Git**, better for a team. A `.gitignore` already excludes the generated folders and the database.

```bash
git init
```
```bash
git add .
```
```bash
git commit -m "FlowGate hackathon project"
```

Then create a **private** repository on GitHub and push.

**Checklist for whoever receives it**

- [ ] `node scripts/doctor.js` prints "Ready"
- [ ] `node server.js --reset` starts and all five pages open
- [ ] Student app: book parking, see the QR pass
- [ ] Gate scanner: Scan in that pass, then Simulate plate read for another student
- [ ] Control room, Peak-Hour Simulation: Stress day, FlowGate + Predict, Run
- [ ] Signage page updates while the simulation runs
- [ ] Optional: copilot badge shows Claude after setting a key
- [ ] Deck shared and exported as PPTX

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `FlowGate needs Node.js 22.13 or newer` | Install the current LTS, open a new terminal |
| `EADDRINUSE`, port 4000 in use | Another copy is running. Stop it, or use `PORT=4100` |
| Charts or QR codes missing, 404 for `/lib/...` | `public/lib/` did not copy. `node scripts/doctor.js` lists what is missing |
| Phone cannot open the LAN address | Same Wi-Fi? Allow `node` in the firewall prompt. Venue Wi-Fi may block it: use a hotspot |
| Phone camera does not start on the gate page | Expected over plain http. Use the code box or Scan in |
| Copilot shows "Offline rules" | `npm install`, set `ANTHROPIC_API_KEY` in the same terminal, restart |
| `pip install` fails building torch | Use Python 3.10 to 3.12, 64-bit. On Windows install from python.org, not the Store |
| Scans say "min after slot" | The demo clock is set. Change or clear it in the control room |
| Data looks wrong after experiments | `node server.js --reset`, or click Reset demo data |
| Windows says `python3` not found | Use `py -3` |

---

## 10. Known limitations, worth saying out loud if asked

- Campus figures are assumptions. Nothing is calibrated against real RNSIT counts yet, apart from
  the gate measurement in `docs/measured/`.
- The predictive controller is evaluated only in simulation (stress day: rain, 60% compliance, East
  Gate closed 08:15 to 08:35). It forecasts from bookings only. With the same low trigger a reactive
  system still peaks at 54, so the gain comes from foresight rather than the threshold.
- Windows and Linux setup steps, and the Windows start file, were written but never run on those systems. The Mac start file was tested end to end.
- The Claude copilot path was never run with a real API key.
- The YOLO counter **has** been run on our own footage. Its accuracy was spot-checked by eye, not
  formally validated: one bus was counted four times as it crossed slowly, and about 18% of raw
  crossings were repeat detections. `docs/measured/` already corrects for this; treat the counts as
  approximate.
- The measurement covers one entrance across 5.8 minutes of one morning. It is not a campus-wide
  arrival rate, and it is not the gate's maximum capacity.
- Plate recognition is a simulated read. No OCR model is included.
- Exit congestion has staggered exit slots but no simulation.
- There is no login. The student app uses a demo picker. A real deployment needs college SSO.
