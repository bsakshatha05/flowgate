# Demo script (about 5 minutes)

## Before you present
1. `node server.js --reset` (fresh data; demo clock set to 08:25 so scans read "on time").
2. Open four tabs: `/student`, `/gate`, `/admin`, `/sign`. If you can, open `/student` on a phone using the LAN address the server prints, and put `/sign` on a second screen or TV.
3. If you will scan a QR with the laptop camera, do one test scan first so the browser has already granted camera permission.
4. In the control room, open **Peak-Hour Simulation**, pick **Stress day**, then **Today (no FlowGate)**, so it is ready.
5. Optional: have `python3 yolo/fake_camera.py --gate G2 --rate 1` ready in a terminal (or the real `yolo/counter.py` with a gate video, only if you tested it).
6. Optional: if you set `ANTHROPIC_API_KEY`, check the copilot badge says "Claude". Otherwise it says "Offline rules", which is fine.

## 1. The student (45 s)

> **Pick the right student.** The demo clock is 08:25, so use someone whose slot covers 08:25 or
> the scan will read "late" and earn no credits. **Pranav Kulkarni (CSE, first year)** works: his
> slot is 08:20 to 08:30. Any first-year in CSE, CSD, CV, ECE or EEE is in the same band. Whoever
> you pick, the slot is printed at the top of the student screen. Check it before you scan.

- Student App: choose **Pranav Kulkarni**. "Pranav is in Computer Science, first year. His slot today is 08:20 to 08:30, leaving in the afternoon."
- Tap **Book parking**. "FlowGate picked the least crowded zone and the gate next to it."
- Tap **Show my pass**. The pass fills the screen, the way a student would hold their phone up at the parking area. "His number plate is registered too, so usually he is not stopped at all." Close it with the × at the top right.
- Open **Green credits**: "Arriving in your slot or carpooling earns points. At 150 you unlock priority parking."

## 2. The gate (40 s)
- Gate Scanner on the laptop: tap **Scan in** for Pranav, or hold a phone's QR up to the laptop camera.
- Then pick him in **Plate camera** and tap **Simulate plate read**. "In production a number-plate camera does this. The vehicle doesn't even stop. He was on time, so that's 10 credits."

## 3. The control room (45 s)
- **Live Ops**: "Both entries are already in the feed and the zone counts moved."
- Start the YOLO counter or the fake camera. If it's the fake one, say so: "This is a simulated feed standing in for our YOLO counter. The badge says Simulated feed."
- Ask the **Copilot**: "Which gate is busiest?" or click **Shift report**.

## 4. The proof: a bad morning (90 s)
- **Peak-Hour Simulation**, Stress day, speed 10, **Today**, **Run**. "Rain, only 60% follow their slot, and at 08:15 a breakdown in the gate mouth cuts the gate to one lane. There is only one vehicle gate on this campus, so there is nowhere to divert to. The queue hits 919 vehicles and spills onto the road for 56 minutes."
- Switch to **FlowGate**, run. "A dedicated two-wheeler lane plus staggered arrivals brings the peak to 196. But the marshal is only sent at 08:19, once the queue is already forming."
- Switch to **FlowGate + Predict**, run. After 08:15, point at the **Auto action** alert and the red dashed line in the forecast card: "The forecast, using only bookings and the incident report, sees the queue coming. It sends the marshal at 08:15, four minutes earlier, and that is enough to cut the peak from 196 to 56 and the spillback from 28 minutes to 11."
- Point at the student tab or phone: "Students get that update on their phone."
- Point at the signage screen: "And the gate display tells arriving drivers which gate to use."
- In Live Ops, click **Emergency lane** to show the signage turn red, then clear it.

## 5. The real data (40 s): your strongest moment

Open `docs/measured/README.md` or the measured slide.

- "Everything you have seen so far is a model. So we went and measured the real thing."
- "On 13 November we filmed our own main gate during the morning rush, in 4K."
- "Our own counter, the same script in this repo, counted **147 vehicles in 5.8 minutes**. Four out of five were two-wheelers."
- "Then we had a person count the same 30 seconds by hand. They got 20, the software got 19. So we know it is good to about five percent."
- "The busiest minute carried **33 vehicles: one every 1.8 seconds**."
- "**And that number changed our design.** If a guard has to scan a QR code at the gate, the gate becomes the bottleneck and we make traffic worse. So we moved the check to the parking area. The gate stays free-flowing, and staggering arrivals does the real work."
- "We also found RNS International School buses use the same gate, so school drop-off lands inside our peak. Our model does not include that yet. That is next."

If a judge pushes on the numbers, say plainly: one entrance, one morning, 5.8 minutes; it does not replace the modelled 53 a minute, which is the whole campus, every institution, arriving at the one vehicle gate. Point them at `docs/measured/`, where the limits are written down, including why we do not quote a pedestrian figure.

## 5b. Adding people (20 s, optional but it lands well)

- **Control Room → People**. Type a judge's name, pick a department, **Add person**.
- Switch to the Student App and pick them from the list: they have a slot, they can book, they get a pass.
- Change **Institution** to the school: the form drops the department and year, and says "arrives for the 08:00 start, FlowGate does not move this one, it works around it."
- "That is the honest boundary of the system. We stagger the college, because that is the timetable we control. The school, the PU college and the degree college keep their own bells, and FlowGate plans around them."
- "A college would not type its roster in. Each institution exports its list once and imports the CSV here. This form is for the stragglers."

## 6. The optimizer (30 s)
- **Slot Optimizer**: "The red spike is today; the green steps are our slots, always under the gate-capacity line. Paste the real timetable here and click Apply; every student's slot updates instantly."

## Likely judge questions
- **What about ISE, you have left it out?** ISE, EIE and AI&DS take no fresh intake in RNSIT's Oct 2025 AICTE disclosure, so they build no new cohort in the model. Their existing second, third and fourth years are still on campus though, so the model understates demand by roughly 500 students, and you can still add those students in the app. Our figures are conservative, not complete.
- **What if someone joins a carpool and then changes their mind?** They tap Leave this carpool. They get their own parking back and lose the 10 points for sharing, because the sharing did not happen.
- **What if the driver pulls out?** They tap Withdraw this offer. Every rider is released and told to make their own way, and the driver loses the priority bay and the 5 points. The app will not let a driver quietly disappear on people who are counting on them.
- **What if someone said car and turns up on a bike?** There is a "coming by something else today" switch in the app. It changes only that day, their registered vehicle stays as it is, and it re-books them into the right kind of space. If they are driving a carpool it refuses until they withdraw, because riders depend on that car.
- **What if people ignore their slot?** The normal day already assumes 20% don't follow it; the stress day assumes 40% don't. Green credits and priority parking are the incentives.
- **Is the forecast AI?** It is a 20-minute queue projection built only from bookings and reported incidents (it never sees the true stress-day demand), driving automatic actions: marshal lane, rider nudges, signage. It is deliberately simple and explainable. The copilot uses Claude when a key is configured and falls back to rules offline.
- **Isn't it just a lower trigger?** No. We tested each action on its own: the marshal alone gets the peak to 65, and the rider nudge alone makes it worse, because moving people inside an already full hour just moves the spike. The gain comes from adding capacity early.
- **Are these real RNSIT numbers?** The simulation numbers are assumptions, labelled in `src/config.js`. But the gate counts in section 5 are real: we filmed our own gate on 13 Nov and counted it with the script in this repo. See `docs/measured/`.
- **Cost?** No new hardware for the pilot: existing CCTV, guards' phones, one laptop, a TV for signage. Plate cameras come later.
- **Privacy?** QR passes carry only a random code. Plates are stored only for students and staff who register a vehicle, and a read only checks in that day's booking. The camera counter counts vehicles and stores no images. The copilot sends only aggregate numbers, never names or plates.
- **Why not just widen the road?** That's months and crores. Spreading arrivals is free and works next week.
