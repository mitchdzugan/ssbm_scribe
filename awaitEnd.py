#!/usr/bin/env python3

import cv2
import os
import numpy as np
import time

dumpPath = ".\\User\\Dump\\Frames"

def main():
    while True:
        files = os.listdir(dumpPath)
        frames = []
        for file in files:
            if file.startswith("framedump_") and file.endswith(".png"):
                frames.append({
                    "file": file,
                    "n": int(file.split(".png")[0].split("framedump_")[1])
                })
        lastFrameN = max(frames, key=lambda frame: frame["n"])["n"]
        lastFramePath = max(frames, key=lambda frame: frame["n"] if frame["n"] != lastFrameN else 0)["file"]
        lastFrame = cv2.imread(dumpPath + "\\" + lastFramePath, cv2.IMREAD_COLOR)
        black = 0
        total = 0
        for y in range(0, lastFrame.shape[0]):
            for x in range(0, lastFrame.shape[1]):
                noR = lastFrame[y, x][0] == 0
                noG = lastFrame[y, x][1] == 0
                noB = lastFrame[y, x][2] == 0
                isBlack = noR and noG and noB
                if isBlack:
                    black += 1
                total += 1
        if (black / total) > 0.985:
            print("DONE")
            break
        else:
            time.sleep(2)
main()