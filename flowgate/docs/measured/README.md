# Measured traffic at RNSIT, 13 November 2026

This folder holds our **first real measurements**, not estimates. Up to this point every figure in
FlowGate came from a model built on assumptions. These came from video of our own campus entrance,
counted with the YOLOv8 script in `yolo/`, and then **checked against a human count**.

## What we filmed

A student recorded the main entrance plaza on the morning of 13 November 2026, in 4K at 30 fps.

| File | Starts | Length |
|---|---|---|
| `VID20261113084444.mp4` | 08:44:44 | 1 min 24 s |
| `VID20261113084653.mp4` | 08:46:53 | 3 min 19 s |
| `VID20261113085312.mp4` | 08:53:12 | 1 min 2 s |

Together: **5.8 minutes inside the 08:44 to 08:54 arrival peak**. The camera was handheld on a
ledge. Drift was 1.6 to 3.2 pixels per half second, small enough for a fixed counting line.

## The results

| | Counted |
|---|---|
| **Vehicles** | **147** |
| Two-wheelers | 121 (**82%**) |
| Cars | 22 |
| Buses | 4 |
| People on foot | about 108 |
| **Mean rate** | **25 vehicles a minute** |
| **Busiest minute** | **33 vehicles**, one every 1.8 seconds |

Per-minute vehicle counts (full minutes only):

```
08:45  15  ###############
08:47  18  ##################
08:48  31  ###############################
08:49  29  #############################
08:53  33  #################################
```

## How accurate is this?

We did not trust the software on its own. A person counted the **same 30 seconds** frame by frame,
tracking each vehicle by its rider's clothing and passengers so nothing was counted twice.

| 30-second window, 08:47:53 to 08:48:23 | Vehicles |
|---|---|
| Counted by hand | 20 |
| Counted by the software | 19 |

**Within 5%.** That is the number to quote if anyone asks whether the counts are trustworthy.

Two honest caveats from the same check:

- **Buses were over-counted.** A bus crossing slowly gets re-detected as a new vehicle. The software
  logged 10 bus crossings where there were about 4. Buses are corrected for in the figures above.
- **The pedestrian count is not reliable.** People walk slowly, so the same person is often counted
  more than once, and the covered walkway is too crowded to resolve person by person. Depending on
  how you correct for it the answer moves between roughly 14 and 64 people a minute. **We quote
  "about 108 people" as an order of magnitude only, and we do not build any claim on it.** An
  earlier version of this project claimed "two people on foot for every vehicle". That claim was
  wrong and has been removed.

## What we learned that changes the design

**1. The gate moves a vehicle every 1.8 seconds at peak.**

This is the single most important practical fact we found, and it rules something out. Any plan that
requires each vehicle to **stop** at the gate must handle one vehicle faster than 1.8 seconds,
including slowing, stopping, being checked and pulling away. Nothing involving a guard and a phone
comes close. A QR scan per vehicle would turn a free-flowing gate into the bottleneck and make
congestion **worse**.

So in a real deployment the QR pass is **not** a gate turnstile. It is:

- the student's proof of a parking space, checked in the parking area, not at the gate
- a spot-check tool, used on a sample rather than on everyone
- the fallback when a plate is unreadable

The gate itself stays free-flowing. This is why the slot system matters: it is the only part of
FlowGate that reduces load without adding a step at the gate.

**2. Four out of five vehicles are two-wheelers.**

Number-plate cameras are far less reliable on two-wheelers than on cars: the plate is small, often
dirty, non-standard, angled, or hidden behind a leg. Marketing ANPR as the main entry method would
not survive contact with this campus. It is a long-term add-on for the car lanes, not the core.

**3. A school shares this entrance.**

The buses are **RNS International School** buses. School drop-off lands inside the college peak.
Any real timetable plan has to be agreed with the school as well, or the two peaks will keep
colliding. Our model does not represent this yet.

## What these numbers do NOT tell us

- **One entrance, 5.8 minutes, one morning.** Not a campus-wide arrival rate.
- **Not comparable to the modelled "53 a minute"**, which is every institution on campus arriving at the one vehicle gate
  and buses, and is a smoothed curve. Two different quantities. Do not swap one for another.
- **Flow is not capacity.** Traffic was moving, so 33 a minute is a lower bound on what this
  entrance can handle, not its ceiling.

## What this measurement changed in the model

Measuring our own gate did not just decorate the deck; it corrected the simulation.

- **Main Gate capacity raised to 35 a minute.** We had assumed 30. We counted 33 passing while
  traffic was still flowing freely, so 30 was demonstrably too low.
- **Arrival spread widened from 5 minutes to 15.** The old assumption implied about 175 vehicles a
  minute at the peak. We measured 33. A 5-minute spread was simply not how people arrive.
- **Daily attendance set to 75%.** Assuming every enrolled student shows up every day inflated
  demand well past anything we observed.

Together these, and the later discovery that five other institutions share this campus, moved the
model to **53 a minute arriving at a gate that clears 35**, which is the project's actual
conclusion: there is one vehicle gate, six institutions start within the same hour, and the fix is to
split that gate into two lanes, stagger arrivals and move the bells apart. The numbers in
`src/config.js` carry `[MEASURED]`, `[RNSIT]` or `[ASSUMED]` tags so you can see which is which.
- No wet day, no Monday-versus-Friday, no evening exit peak.

## Reproducing this

```bash
cd yolo
python measure.py --source /path/to/VID20261113084653.mp4 --out run --start-clock 08:46:53 \
  --line "0.50,0.40,0.50,0.95" --model yolov8s.pt --imgsz 1280 --stride 2
```

`--preview-only` draws the counting line on the first frame so you can check it sits across the road
before spending the compute. On an M-series Mac, 3 minutes of 4K took about an hour with three jobs
competing. Run them one at a time.

Files here: `measured-summary.json` (everything combined), `run-*.json` (per clip, every individual
crossing with its timestamp), `run-*.csv` (per-minute counts), `measure.py` (the exact script).

## What to film next

**A fixed camera on a tripod at the main gate, square across the entry lane, 08:15 to 09:15**, and
the same for the evening exit. A still camera removes the drift, and a full hour gives the real
arrival curve and the real gate capacity, which are the two numbers the whole model rests on.
