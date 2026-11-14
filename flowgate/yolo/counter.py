"""
FlowGate gate camera counter.

Counts vehicles crossing a virtual line in a gate camera feed (CCTV, webcam or a
video file) using YOLOv8 + ByteTrack, and posts each crossing to the FlowGate
server at POST /api/counts.

Setup (Python 3.9+):
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt

Run:
    python counter.py --source gate.mp4 --gate G1            # video file
    python counter.py --source 0 --gate G2 --show            # webcam
    python counter.py --source rtsp://user:pass@ip/stream --gate G1   # CCTV

The line is horizontal at --line (fraction of frame height). Objects moving
down across it count as "in", up as "out" (flip with --invert).
"""
import argparse
import json
import time
import urllib.request

# COCO class ids -> FlowGate vehicle types
CLASS_MAP = {1: "2W", 3: "2W", 2: "4W", 7: "4W", 5: "BUS"}  # bicycle, motorcycle, car, truck, bus


def post(server, gate, direction, vtype):
    body = json.dumps({"gateId": gate, "direction": direction, "vehicleType": vtype, "count": 1}).encode()
    req = urllib.request.Request(f"{server}/api/counts", data=body, headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=3).read()
    except Exception as e:  # keep counting even if the server blips
        print(f"[warn] could not post count: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="0", help="video file, webcam index or RTSP url")
    ap.add_argument("--gate", default="G1", choices=["G1", "G2", "G3"])
    ap.add_argument("--server", default="http://localhost:4000")
    ap.add_argument("--model", default="yolov8n.pt", help="downloaded automatically on first run")
    ap.add_argument("--line", type=float, default=0.6, help="counting line position (0 to 1 of frame height)")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--invert", action="store_true", help="swap in/out direction")
    ap.add_argument("--show", action="store_true", help="show annotated preview window")
    args = ap.parse_args()

    import cv2
    from ultralytics import YOLO

    model = YOLO(args.model)
    source = int(args.source) if args.source.isdigit() else args.source
    last_y = {}      # track id -> last centre y
    counted = set()  # track ids already counted
    totals = {"in": 0, "out": 0}
    t0 = time.time()

    for result in model.track(source=source, stream=True, persist=True, conf=args.conf,
                              classes=list(CLASS_MAP.keys()), tracker="bytetrack.yaml", verbose=False):
        frame = result.orig_img
        h, w = frame.shape[:2]
        line_y = int(h * args.line)
        boxes = result.boxes
        if boxes is not None and boxes.id is not None:
            for xyxy, tid, cls in zip(boxes.xyxy.tolist(), boxes.id.int().tolist(), boxes.cls.int().tolist()):
                cy = (xyxy[1] + xyxy[3]) / 2
                prev = last_y.get(tid)
                last_y[tid] = cy
                if prev is None or tid in counted:
                    continue
                crossed_down = prev < line_y <= cy
                crossed_up = prev > line_y >= cy
                if crossed_down or crossed_up:
                    direction = "in" if crossed_down else "out"
                    if args.invert:
                        direction = "out" if direction == "in" else "in"
                    vtype = CLASS_MAP.get(cls, "2W")
                    counted.add(tid)
                    totals[direction] += 1
                    post(args.server, args.gate, direction, vtype)
                    print(f"{time.strftime('%H:%M:%S')}  {args.gate}  {direction:<3}  {vtype}   totals={totals}")
                if args.show:
                    x1, y1, x2, y2 = map(int, xyxy)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 200, 120), 2)
                    cv2.putText(frame, f"#{tid} {CLASS_MAP.get(cls)}", (x1, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 120), 1)
        if args.show:
            cv2.line(frame, (0, line_y), (w, line_y), (60, 60, 230), 2)
            fps = 1 / max(1e-6, time.time() - t0); t0 = time.time()
            cv2.putText(frame, f"IN {totals['in']}  OUT {totals['out']}  {fps:.0f} fps", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            cv2.imshow(f"FlowGate {args.gate}", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break


if __name__ == "__main__":
    main()
