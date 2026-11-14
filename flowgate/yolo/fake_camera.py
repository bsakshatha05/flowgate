"""
Stand-in for the camera counter (posts with source "simulated", shown as "Simulated feed") when you have no video or no GPU.
Posts random vehicle crossings to FlowGate so the dashboard's camera feed is live.

    python3 yolo/fake_camera.py --gate G1 --rate 3
"""
import argparse
import json
import random
import time
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--gate", default="G1", choices=["G1", "G2", "G3"])
ap.add_argument("--server", default="http://localhost:4000")
ap.add_argument("--rate", type=float, default=2.0, help="vehicles per second")
args = ap.parse_args()

types = ["BUS"] if args.gate == "G3" else ["2W"] * 8 + ["4W"] * 2
print(f"Posting simulated camera counts for {args.gate} to {args.server} (Ctrl+C to stop)")
while True:
    body = {"gateId": args.gate, "direction": "in" if random.random() < 0.85 else "out",
            "vehicleType": random.choice(types), "count": 1, "source": "simulated"}
    req = urllib.request.Request(f"{args.server}/api/counts", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=3).read()
        print(body)
    except Exception as e:
        print("could not reach server:", e)
    time.sleep(random.expovariate(args.rate))
