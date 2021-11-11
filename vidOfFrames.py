#!/usr/bin/env python3

import cv2
import os
import numpy as np

dumpPath = "C:\\Users\\Mitch\\AppData\\Roaming\\Slippi Launcher\\playback\\User\\Dump\\Frames"

def main():
    files = os.listdir(dumpPath)
    frames = []
    vid = cv2.VideoWriter("./videoOnly.avi", cv2.VideoWriter_fourcc(*'MJPG'), 60, (1920, 1080))
    for file in files:
        if file.startswith("framedump_") and file.endswith(".png"):
            frames.append({
                "file": file,
                "n": int(file.split(".png")[0].split("framedump_")[1])
            })
    frames.sort(key=lambda frame: frame["n"])
    for frame in frames:
        print([frame["n"], len(frames)])
        img = cv2.imread(dumpPath + "\\" + frame["file"], cv2.IMREAD_COLOR)
        if img is None:
            continue
        yOff = 0
        xOff = 300
        final = np.zeros((1080, 1920, 3), dtype="uint8")
        final[yOff:yOff + img.shape[0], xOff:xOff + img.shape[1]] = img
        vid.write(final)
    vid.release()

main()