# How to run FlowGate

This guide is for setting it up on a new computer. No experience needed.

**Already have an older copy?** Do not use this guide. Open `START-HERE.md` instead. It is shorter.

**Time needed:** about 10 minutes.

---

## What you need

One free program called **Node**. That is all.

You do not need to be online to run FlowGate. You only need the internet once, to download Node.

---

## Step 1: Install Node

### On a Mac

1. Go to **https://nodejs.org**
2. Click the big green button on the left. It says **LTS**.
3. Open the file that downloads. Click **Continue** until it finishes.

### On Windows

1. Go to **https://nodejs.org**
2. Click the big green button on the left. It says **LTS**.
3. Open the file that downloads. Click **Next** until it finishes.
4. Close any black windows you have open, so the computer notices the new program.

---

## Step 2: Start FlowGate

### The easy way: double-click

In the `flowgate` folder there are two start files. Double-click the one for your computer:

| Your computer | Double-click this |
|---|---|
| Mac | **Start FlowGate (Mac).command** |
| Windows | **Start FlowGate (Windows).bat** |

A black window opens and your browser opens FlowGate a few seconds later. You can skip to Step 3.

> **Mac: a warning about an unidentified developer?** That is normal the first time. **Right-click**
> the file instead, choose **Open**, then **Open** again. You only do this once.
>
> **Windows: a blue "Windows protected your PC" box?** Click **More info**, then **Run anyway**.

### The other way: type one line

Use this if the double-click did not work.

### On a Mac

1. Press **Command** and **Space** together. Type `terminal` and press **Enter**. A white or black window opens.
2. Type this, then press the space bar. **Do not press Enter yet:**

```bash
cd 
```

3. Now drag the `flowgate` folder from Finder into that window. It fills in the location for you.
4. Press **Enter**.
5. Type this and press **Enter**:

```bash
node server.js --reset
```

### On Windows

1. Open the `flowgate` folder.
2. Click once on the white bar at the top that shows the folder name. The text turns blue.
3. Type `cmd` and press **Enter**. A black window opens.
4. Type this and press **Enter**:

```bash
node server.js --reset
```

### What you should see

A few lines of text ending with:

```
FlowGate running:  http://localhost:4000
```

**Leave this window open.** FlowGate only works while it is open.

---

## Step 3: Open it

Open your web browser. In the address bar at the top, type this and press Enter:

**http://localhost:4000**

You should see the FlowGate home page.

---

## What you can click

| Page | What it is |
|---|---|
| Home | A summary of the project |
| Student App | What a student sees on their phone: their arrival time, parking, QR pass |
| Gate Scanner | What the security guard uses to scan a student in |
| Control Room | The big screen for campus security, with the live map and the traffic simulation |
| Gate Signage | The display that would go on a TV near the gate |

Click the links at the top of the page to move between them.

---

## How to stop it

Click on the black window and press **Control** and **C** together. Then close the window.

To start it again later, double-click the same start file.

---

## Showing it on a phone

When FlowGate starts, it prints a second line like this:

```
On your phone (same wifi):  http://192.168.1.20:4000
```

Type that address into your phone's browser. Your phone must be on the same wifi.

- Your computer may ask permission to accept connections. Click **Allow**.
- College wifi often blocks this. If it does not work, make a hotspot from your laptop and connect the phone to that.
- The camera for scanning QR codes does not work on a phone this way. Use the **Scan in** button on the screen instead, or scan on the laptop.

---

## Two optional extras

You do not need either of these. The project works fully without them.

**1. AI answers in the Control Room.** By default the assistant answers using built-in rules. To use real AI instead, you need an Anthropic account and a paid key. See `docs/TECHNICAL.md`.

**2. Counting vehicles from video.** We already did this once, and the results are in `docs/measured/`. To run it yourself on new video you need Python and about 2 GB of downloads. See `docs/TECHNICAL.md`.

---

## If something goes wrong

**It says `node` is not found.**
Node did not install, or the computer has not noticed it yet. Close the black window, open a new one, and try again. If it still fails, install Node again from Step 1.

**It says something about a port, or `EADDRINUSE`.**
FlowGate is already running in another window. Find that window and press Control and C. Then try again.

**The web page will not open.**
Check the black window is still open and has not stopped. The page only works while it is running.

**The page opens but looks broken, with no pictures or charts.**
Some files did not copy across. Ask for the zip file again.

**Something looks wrong with the data.**
Type this and press Enter. It resets everything to a clean start:

```bash
node server.js --reset
```

**Check everything at once.**
Type this and press Enter. It tells you what is working and what is not:

```bash
node scripts/doctor.js
```

**The start file closes immediately.**
Node is probably missing. Do Step 1 again. On Windows, restart the computer afterwards.

**Still stuck?** Take a photo of the black window showing the error and send it to Akshay.

---

## Things to know before you present

- **The numbers in the simulation are estimates**, not real RNSIT data. They are clearly labelled everywhere.
- **The numbers in `docs/measured/` are real.** We filmed our own gate on 13 November 2026 and counted it.
- **The PowerPoint** in `docs/` is the pitch deck, with the current screenshots and numbers.
- **Fill in your names** on the first and last slides of the deck.

---

## For developers

The technical detail lives in **`docs/TECHNICAL.md`**: how the parts fit together, where every assumption is stored, how to change the numbers, how to re-zip the project, and the full list of known limitations.
