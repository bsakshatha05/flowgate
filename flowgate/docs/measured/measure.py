"""
Measure real campus traffic from RNSIT footage.

Counts vehicles and pedestrians crossing a line on the internal campus road using
YOLOv8 + ByteTrack, and writes a per-minute arrival curve to JSON/CSV.

    python measure.py --source video.mp4 --start-clock 08:53:12 --out run1

Outputs:
  <out>.json   per-minute counts, totals, settings
  <out>.csv    minute,vehicles,2w,4w,bus,pedestrians
  <out>-preview.jpg  the counting line drawn on a frame (check this first)
"""
import argparse
import json
import csv
import os
from collections import defaultdict

import cv2
from ultralytics import YOLO

# COCO class ids -> our categories
CLASS_MAP = {1: "2W", 3: "2W", 2: "4W", 7: "4W", 5: "BUS", 0: "PED"}
VEHICLE = {"2W", "4W", "BUS"}


def side(p, a, b):
    """Which side of line a->b the point p is on (sign of cross product)."""
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def within_segment(p, a, b, pad=0.15):
    """True if p projects onto segment a->b (with a little padding), so we do not
    count things crossing the infinite line far off the road."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return False
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2
    return -pad <= t <= 1 + pad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", default="run")
    ap.add_argument("--model", default="yolov8s.pt")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--line", default="0.34,0.38,0.62,0.86",
                    help="x1,y1,x2,y2 as fractions of frame width/height")
    ap.add_argument("--start-clock", default="08:53:12", help="wall clock at video t=0")
    ap.add_argument("--stride", type=int, default=2, help="process every Nth frame")
    ap.add_argument("--max-seconds", type=float, default=0)
    ap.add_argument("--preview-only", action="store_true")
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.source)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    ok, frame0 = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("cannot read video")

    fx1, fy1, fx2, fy2 = [float(v) for v in args.line.split(",")]
    A = (fx1 * W, fy1 * H)
    B = (fx2 * W, fy2 * H)

    # preview image so a human can confirm the line sits across the road
    prev = frame0.copy()
    cv2.line(prev, (int(A[0]), int(A[1])), (int(B[0]), int(B[1])), (60, 60, 230), 3)
    cv2.putText(prev, "counting line", (int(A[0]), max(20, int(A[1]) - 10)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 230), 2)
    cv2.imwrite(f"{args.out}-preview.jpg", prev)
    if args.preview_only:
        print(f"preview written: {args.out}-preview.jpg  ({W}x{H}, {fps:.2f} fps)")
        return

    h0, m0, s0 = [int(x) for x in args.start_clock.split(":")]
    start_sec = h0 * 3600 + m0 * 60 + s0

    model = YOLO(args.model)
    last_side = {}
    counted = set()
    per_min = defaultdict(lambda: defaultdict(int))
    totals = defaultdict(int)
    events = []

    stream = model.track(source=args.source, stream=True, persist=True, conf=args.conf,
                         imgsz=args.imgsz, classes=list(CLASS_MAP.keys()),
                         tracker="bytetrack.yaml", verbose=False, vid_stride=args.stride)

    processed = 0
    for result in stream:
        processed += 1
        t = (processed * args.stride) / fps
        if args.max_seconds and t > args.max_seconds:
            break
        boxes = result.boxes
        if boxes is None or boxes.id is None:
            continue
        for xyxy, tid, cls in zip(boxes.xyxy.tolist(), boxes.id.int().tolist(), boxes.cls.int().tolist()):
            kind = CLASS_MAP.get(cls)
            if kind is None:
                continue
            # feet of the object track the road better than the centre
            cx = (xyxy[0] + xyxy[2]) / 2
            cy = xyxy[1] + 0.85 * (xyxy[3] - xyxy[1])
            p = (cx, cy)
            s = side(p, A, B)
            prev_s = last_side.get(tid)
            last_side[tid] = s
            if prev_s is None or tid in counted:
                continue
            if (prev_s < 0) != (s < 0) and within_segment(p, A, B):
                counted.add(tid)
                direction = "A" if prev_s < 0 else "B"
                clock_sec = start_sec + t
                minute = int(clock_sec // 60)
                label = f"{minute // 60 % 24:02d}:{minute % 60:02d}"
                per_min[label][kind] += 1
                per_min[label][f"{kind}_{direction}"] += 1
                if kind in VEHICLE:
                    per_min[label]["VEH"] += 1
                    totals["VEH"] += 1
                totals[kind] += 1
                totals[f"{kind}_{direction}"] += 1
                events.append({"t": round(t, 2), "clock": label, "kind": kind, "dir": direction, "id": tid})

    minutes = sorted(per_min.keys())
    rows = [{"minute": m, "vehicles": per_min[m]["VEH"], "2W": per_min[m]["2W"],
             "4W": per_min[m]["4W"], "BUS": per_min[m]["BUS"], "pedestrians": per_min[m]["PED"],
             "veh_dirA": per_min[m]["2W_A"] + per_min[m]["4W_A"] + per_min[m]["BUS_A"],
             "veh_dirB": per_min[m]["2W_B"] + per_min[m]["4W_B"] + per_min[m]["BUS_B"]}
            for m in minutes]
    veh_rates = [r["vehicles"] for r in rows]
    # ignore first/last minute: they are partial
    full = veh_rates[1:-1] if len(veh_rates) > 2 else veh_rates
    summary = {
        "source": os.path.basename(args.source),
        "frame_size": [W, H], "fps": round(fps, 2), "stride": args.stride,
        "model": args.model, "conf": args.conf, "imgsz": args.imgsz,
        "line_fractions": args.line, "start_clock": args.start_clock,
        "duration_seconds": round((processed * args.stride) / fps, 1),
        "totals": dict(totals),
        "vehicles_per_minute": {
            "mean": round(sum(full) / len(full), 1) if full else 0,
            "peak": max(full) if full else 0,
            "minutes_counted": len(full),
        },
        "per_minute": rows,
    }
    with open(f"{args.out}.json", "w") as f:
        json.dump({"summary": summary, "events": events}, f, indent=2)
    with open(f"{args.out}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["minute", "vehicles", "2W", "4W", "BUS", "pedestrians", "veh_dirA", "veh_dirB"])
        w.writeheader()
        w.writerows(rows)

    print(json.dumps({k: summary[k] for k in
                      ["duration_seconds", "totals", "vehicles_per_minute"]}, indent=2))
    for r in rows:
        print(f"  {r['minute']}  vehicles {r['vehicles']:3d}  (2W {r['2W']:3d}  4W {r['4W']:2d}  bus {r['BUS']})  dir {r['veh_dirA']}/{r['veh_dirB']}  pedestrians {r['pedestrians']:3d}")


if __name__ == "__main__":
    main()
