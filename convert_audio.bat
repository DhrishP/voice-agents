@echo off
REM Convert ulaw to wav using ffmpeg
ffmpeg -f mulaw -ar 8000 -ac 1 -i "recordings\call-a87b4954-abd9-450e-b97b-bab2e09b2d51-1742327864505.ulaw" output.wav
pause 