# FlowGate: Smart Campus Traffic Management for RNSIT

**Team:** [Team name] · **Members:** [Names] · **Track:** [Hackathon track]

## Problem statement
Traffic congestion near RNSIT during peak hours, particularly during college entry and exit times, causes delays, inefficient vehicle movement, parking-related congestion, and safety concerns for students, faculty, pedestrians, and the surrounding community.

## Key insight
**This is not one college with a traffic problem. It is six institutions sharing one gate.**

RNS Institute of Technology, its MBA and MCA programmes, RNS International School, RNS PU College and RNS First Grade College all sit on or beside the same campus and funnel onto the same entrance from Dr. Vishnuvardhan Road (also signed Uttarahalli Main Road), the arterial between Kengeri and Uttarahalli. Together they bring roughly 8,900 students through one morning.

Their start times overlap rather than stagger: the school at **08:00** and again at **08:45**, the PU college at **08:30**, the engineering college at **09:00**. And there is **one vehicle gate** for all of it. Not a second gate that happens to be shut: one gate is all there is. So about **53 vehicles a minute** arrive at a gate that clears **35**.

That rules out the obvious answer and leaves three that are actually available, none of which needs new road:
1. **Make two lanes out of the one gate.** Four in five vehicles are two-wheelers (measured), queueing behind cars that are turning. A dedicated two-wheeler lane is paint, two barriers and a guard, and takes the gate from 35 to about **47 a minute**.
2. **Stagger arrivals** within the engineering college, using the timetable it already has.
3. **Coordinate the bells** between institutions, which is free and is the one fix nobody is currently making.


## Solution
FlowGate is a predictive, low-cost campus traffic system. A **slot optimizer** turns the class timetable into 10-minute entry and exit windows per department and year, keeping arrivals under gate capacity. A **predictive controller** forecasts gate queues 20 minutes ahead from bookings and reported incidents; when a queue is coming, it sends a marshal to open a second lane before the queue forms and asks riders who have not left yet to leave a little later. A mobile-first **student app** shows each person their slot, pre-books parking at the least crowded zone, issues a **QR gate pass**, registers their **number plate for hands-free entry**, matches **carpools**, and awards **green credits** that unlock priority parking. **Gate signage** on any TV tells arriving drivers which gate to use, shows pedestrian signals and flags emergency lanes. A live **control room** brings it together with a camera-based vehicle count (**YOLOv8**) and a **copilot** that answers questions and writes shift reports (Claude when online, rules when offline).

## Measured at RNSIT (real data, 13 November 2026)

We filmed our own main gate during the morning peak and counted it with our YOLOv8 script. In **5.8 minutes of 4K footage between 08:44 and 08:54** it counted **147 vehicles**, **82% of them two-wheelers**, at a mean of 25 a minute and **33 in the busiest minute**. We then had a person count the same 30 seconds by hand: 20 vehicles against the software's 19, so the counts are good to about 5%.

That peak rate is one vehicle every 1.8 seconds, and it rules a design out. Anything that stops each vehicle at the gate, including a guard scanning a QR code, becomes the bottleneck and makes congestion worse. So the QR pass is checked at the parking area and used for spot-checks, never as a gate turnstile, and the gate stays free-flowing. Staggering arrivals is the only measure that cuts load without adding a step at the gate. With 82% two-wheelers, whose plates are small and often obscured, number-plate cameras are a later addition on the car lanes rather than the core. We also found **RNS International School sits on this campus** (CBSE lists its address as "RNSIT Campus"), so school drop-off lands inside the college peak. The model now represents this and the other institutions explicitly. Method and limits: `docs/measured/`. One entrance, one morning, and not interchangeable with the modelled 53/min below, which is every institution arriving at the one open gate.

## Results (simulated, assumed data)
| Normal day | Today | With FlowGate |
|---|---|---|
| Gate capacity | 35 / min (one mixed lane) | 47 / min (two-wheeler lane added) |
| Peak gate queue | 311 vehicles | 3 |
| Worst wait at gate | 8.9 min | 0.5 min |
| Queue on main road | 41 min | 0 min |

| Stress day (rain, 60% follow slots, gate down to one lane for 20 min) | Today | FlowGate, reactive | FlowGate + Predict |
|---|---|---|---|
| Peak gate queue | 919 | 196 | **56** |
| Worst wait at gate | 32.8 min | 7.1 min | 2.0 min |
| Queue on main road | 56 min | 28 min | 11 min |

With only one gate there is nowhere to divert to, so an incident in the gate mouth is far more costly than it would be on a two-gate campus. That is precisely why seeing it twenty minutes early is worth so much here.

Built on RNSIT's **AICTE sanctioned intake of 1,380 a year** (mandatory disclosure, Oct 2025), giving 5,520 undergraduates plus 720 in MBA and MCA, the other institutions on campus, 312 faculty, our measured 82% two-wheeler share, and a Main Gate capacity of at least 35 a minute taken from our footage. Still assumed: head counts for the school and the PU college, 80% slot compliance, carpooling removing 30% of student cars, and the private-vehicle share, which we calibrated down until the modelled peak stopped contradicting the free-flowing 33 a minute we filmed. Treat the simulated figures as the shape of the problem rather than exact numbers.

## Tech stack
Node.js 22.13+ with built-in SQLite and Server-Sent Events (core needs no npm packages and no internet), vanilla HTML/CSS/JS with Chart.js, qrcode-generator and jsQR, Python YOLOv8 + ByteTrack for vehicle counting, optional Claude API for the copilot. Runs on one laptop.

## Feasibility and rollout
No new hardware for a pilot: existing CCTV, guards' phones, one laptop, a TV for signage. Weeks 1 to 2: measure real arrival curves with the camera counter. Weeks 3 to 4: pilot with two departments. Month 2: whole campus. Later: plate cameras at the gates.

## Future scope
Plate cameras with on-device OCR, live college bus GPS, traffic police and signal timing data, EV charging slots in the booking flow, an exit-hour simulation, college SSO login.
