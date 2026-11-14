# Start here

Everything you need is in this folder. You do not need anyone's help to run it.

---

## Already have an older copy of FlowGate?

1. Find your old `flowgate` folder. Right-click it and choose **Rename**. Call it `flowgate-old`.
2. Put this new `flowgate` folder where the old one was.
3. Carry on below.

(Keep the old folder for a week, then delete it.)

---

## Running it: 2 steps

### Step 1: Install Node (once)

Skip this if you have run FlowGate before on this computer.

1. Go to **https://nodejs.org**
2. Click the big green button on the left. It says **LTS**.
3. Open the file that downloads. Keep clicking **Continue** or **Next** until it finishes.
4. **Windows only:** restart the computer afterwards.

### Step 2: Double-click the start file

In this folder, double-click:

### **Start FlowGate (Windows).bat**

A black window opens, and your web browser opens FlowGate a few seconds later. That is it.

> **You will probably see a blue box saying "Windows protected your PC".** This is normal for any
> file that came from the internet. Click **More info**, then **Run anyway**. You only do this once.

> **If your antivirus blocks it**, that is also normal for a `.bat` file. Allow it, or use the
> manual way below.

*(On a Mac the file is **Start FlowGate (Mac).command**. The first time, right-click it, choose
**Open**, then **Open** again.)*

### If the start file does not work

Do it by hand instead. It is three lines:

1. Open the `flowgate` folder.
2. Click once on the white bar at the top showing the folder name. The text turns blue.
3. Type `cmd` and press **Enter**. A black window opens.
4. Type this and press **Enter**:

```bash
node server.js --reset
```

5. Open your browser and go to **http://localhost:4000**

---

## While it is running

**Keep the black window open.** FlowGate only works while it is open.

If the browser did not open by itself, open it and type this in the address bar:

**http://localhost:4000**

### To stop it

Click the black window and press **Control** and **C** together. Then close the window.

### To start it again later

Double-click the same start file.

---

## What you can click

| Page | What it is |
|---|---|
| Home | A summary of the project |
| Student App | What a student sees on their phone: arrival time, parking, QR pass |
| Gate Scanner | What the security guard uses to scan a student in |
| Control Room | The big screen for security: live map, the traffic simulation, and **People** for adding students or importing a roster |
| Gate Signage | The display that would go on a TV near the gate |

Use the links at the top of the page to move between them.

---

## If something goes wrong

Try these in order. One of them will fix it.

**1. Run the checker.**

Double-click the start file. If it closes instantly or shows an error, the checker will tell you
what is wrong in plain words. To run it on its own:

- Mac: open the **Terminal** app, type `cd ` and a space, drag this folder into the window, press Enter, then type `node scripts/doctor.js` and press Enter.
- Windows: open this folder, click the white bar at the top, type `cmd`, press Enter, then type `node scripts/doctor.js` and press Enter.

It prints a list. Anything saying **FIX** tells you exactly what to do.

**2. It says Node is not installed.**

Do Step 1 above. On Windows, restart the computer afterwards. Then try again.

**3. It says something about a port, or `EADDRINUSE`.**

FlowGate is already running in another window. Find that window, press Control and C, close it,
then double-click the start file again.

**4. The page will not open, or says it cannot connect.**

Check the black window is still open. If it closed, open it again. The page only works while that
window is running.

**5. The page opens but there are no charts or QR codes.**

Some files did not copy across. Ask for the zip file to be sent again, and unzip the whole thing
rather than dragging pieces out of it.

**6. The data looks wrong, or you want a clean start.**

Close the black window and double-click the start file again. It resets to clean demo data
every time.

**7. Nothing above worked.**

Take a photo of the black window showing the error, and send it to Akshay.

---

## What changed in this version

Two big things, and they changed the whole answer.

**1. This campus is not one college. It is six.**

RNSIT, its MBA and MCA, RNS International School, the PU college and the degree college are all on
or beside the same campus. That is close to 9,000 people arriving on one morning.

And their start times overlap instead of taking turns:

| Who | Starts |
|---|---|
| School, grades 5 to 10 | 8:00 |
| PU college | 8:30 |
| School, nursery to grade 4 | 8:45 |
| Engineering and degree college | 9:00 |

**2. There is only one vehicle gate.**

Not a second gate that happens to be closed. One gate is all there is. So about **53 vehicles a
minute** arrive at a gate that can clear **35**. That is the whole problem in one line.

**So the plan is now three things, none of which needs building anything:**

1. **Make two lanes out of the one gate.** Four in five vehicles are two-wheelers, stuck behind cars
   that are turning. Give them their own lane: paint, two barriers and a guard. The gate goes from
   35 a minute to about 47.
2. **Give each class its own ten-minute arrival slot**, built from the timetable the college already has.
3. **Ask the school and the college to move their start times apart.** This one is free, and nobody
   is doing it today.

**The numbers, if a judge asks:**

| | Today | FlowGate | + Predict |
|---|---|---|---|
| Normal day, longest queue | 311 | 3 | 3 |
| Bad day, longest queue | 919 | 196 | **56** |
| Bad day, spillback onto the road | 56 min | 28 min | 11 min |

The bad day is rain, only 60% keeping their slot, and a breakdown cutting the gate to one lane for
20 minutes. With one gate there is nowhere to divert to, which is why seeing it coming 20 minutes
early is worth so much.

**Also new:**

- The whole app is now in RNSIT's own colours, navy and orange, on a light background.
- The campus map matches the real site: RNS Farms Road off Dr. Vishnuvardhan Road, Main Gate at the top.
- `docs/DEMO_SCRIPT.md` is updated. **Read it before presenting.** It tells you which student to
  pick so the scan says "on time" instead of "late".

**The explainer video** is a separate file, sent alongside this folder. It is 6 minutes 20 seconds,
walks through every page, ends with a week-by-week plan for actually doing it, and has subtitles in
English, Hindi and Kannada.

**The pitch deck** is the PowerPoint file in `docs/`. This is the current one, with the real
screenshots and the real numbers. The out-of-date version has been deleted, so if you find only one
deck in there, that is the right one.

---

## Want more detail?

- **`docs/SETUP.md`** explains the same steps in more detail, including how to show it on a phone.
- **`docs/TECHNICAL.md`** is for developers: how it is built, where the numbers live, how to change them.
- **`docs/DEMO_SCRIPT.md`** is what to say when presenting.
- **`docs/measured/`** is the real data from our campus.
