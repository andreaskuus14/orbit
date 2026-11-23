#!/bin/sh
# Quadrant check for the motion test: flags any frame where a quarter of the picture is near-black (mean luma < 12) or drops by
# more than half against the frame before (an unfinished or unloaded tile). Usage: scripts/earth/check-frames.sh earth-motion.mp4
set -e
v="$1"; bad=0
for q in "0:0" "iw/2:0" "0:ih/2" "iw/2:ih/2"; do
  ffmpeg -loglevel error -i "$v" -vf "crop=iw/2:ih/2:${q},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=/tmp/q.txt" -f null -
  n=$(grep YAVG /tmp/q.txt | awk -F= -v q="$q" '{y=$2; i=NR-1; if (y<12 || (p>20 && y<p*0.5)) {print "frame " i " quadrant " q " luma " y " (before " p ")"; c++} p=y} END{print c+0 > "/dev/stderr"}' 2>/tmp/qc.txt | tee /dev/stderr | wc -l)
  bad=$((bad + n))
done
echo "flagged: $bad"
[ "$bad" -eq 0 ]
