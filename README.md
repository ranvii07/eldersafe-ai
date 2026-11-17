# ElderSafe AI — Fall Detection & Caregiver Alert

A camera-based fall-detection prototype for elderly people. It watches a camera, webcam or UR Fall Detection Dataset clip,
finds the body with **MediaPipe Pose**, decides whether a fall happened, and the **back end** alerts the saved relatives.

## Deploy on Vercel (no command line)

1. Go to **vercel.com → Add New → Project**, pick this GitHub repo and press **Deploy**. Leave every setting as it is.
2. In the new project, open **Storage → Create → Blob**, create a store and **connect it to this project**.
3. Open **Deployments → ⋯ → Redeploy** so the back end picks up the storage key.

The site now works fully. Without step 2 the app still opens, but contacts and alerts are only kept temporarily
(the badge in the top-right corner says which storage is in use).

**Optional: automatic alert emails.** In **Settings → Environment Variables** add `GMAIL_USER` (a Gmail address) and
`GMAIL_APP_PASSWORD` (a Google *App Password*, created under Google Account → Security → 2-Step Verification → App passwords),
then redeploy. Without these, each alert still gets one-click **WhatsApp** links to every saved relative.

## How to use

| Tab | What it does |
|---|---|
| **Monitor** | Load a UR clip (`fall-01-cam0-rgb.zip`), an `.mp4`, or the live webcam. The skeleton and posture label (standing / sitting / bending / lying / FALL) are drawn on each frame. When a fall is detected the back end is called and the alert appears with the relatives it went to. |
| **Contacts** | Save a relative's name, relation, phone, email and address. Stored by the back end. |
| **Alert history** | Every alert the back end sent, with time, source and who was notified. |
| **Evaluate model** | Tests the model on our 19 UR clips with leave-one-clip-out and shows accuracy, recall, specificity, confusion matrix and per-clip results. It can also re-extract landmarks from the original UR zip files in the browser. |

## Method

1. **Input**: UR Fall Detection Dataset, camera 0 RGB, 640×480 at 30 fps — 9 fall clips (`fall-01`…`fall-09`) and 10 daily-activity clips (`adl-01`…`adl-10`).
2. **Pose**: MediaPipe Pose gives 33 body landmarks per frame.
3. **Features per frame**: torso angle from vertical (shoulder-midpoint to hip-midpoint), body box ratio (width ÷ height), hip height, body size.
4. **Preprocessing**
   - **Median**: frames where no body was found are filled with the median of nearby frames, then every feature is median-smoothed (removes landmark jitter).
   - **Mode**: each frame gets a posture category; the most common posture in a short window (mode) is used so one bad frame cannot change the decision.
   - **Label**: clips are labelled from their file name — `fall` = 1, `adl` = 0.
5. **Fall rule (model)**: a fall is flagged when the body becomes *lying* (torso angle ≥ A or box ratio ≥ R), the hips came down quickly just before (drop speed ≥ V body-heights per second), and the person stays lying for ≥ D seconds.
6. **Training**: A, R, V and D are learned by a grid search that maximises correct clips.
7. **Testing**: leave-one-clip-out — train on 18 clips, test on the one left out, repeat for all 19.
8. **Alert**: the front end calls `POST /api/alert`; the back end loads the saved contacts, emails them (if configured), and stores the alert.

### Results on our 19 clips (leave-one-clip-out)

| | Predicted fall | Predicted no fall |
|---|---|---|
| **Actual fall (9)** | 7 | 2 |
| **Actual no fall (10)** | 1 | 9 |

Accuracy 84.2 % · Recall 77.8 % · Specificity 90.0 % · Precision 87.5 %.
Final thresholds (trained on all 19): torso angle ≥ 55°, box ratio ≥ 1.2, hip drop ≥ 0.2 body-heights/s, lying ≥ 0.5 s.
The Evaluate tab reproduces these numbers.

## Project structure

```
public/            front end (static)
  index.html       page with the four tabs
  app.js           camera / video / zip playback, MediaPipe, drawing, API calls, evaluation UI
  core.js          features, preprocessing (median, mode, label), fall rule, training, leave-one-clip-out
  data/ur-landmarks.json   MediaPipe landmarks extracted from the 19 UR clips
api/               back end (Vercel serverless functions)
  contacts.js      GET / POST / DELETE relatives
  alert.js         POST = fall alert to saved relatives, GET = alert history
  model.js         GET / POST the model thresholds used by Monitor
lib/store.js       storage (Vercel Blob, or temporary memory if no store is connected)
```

## Limitations

- Student prototype: reports a *possible* fall, does not diagnose injury, not a certified emergency system.
- Small dataset (19 clips, one room, actors). Real homes have other lighting, angles and furniture.
- Needs the whole body in view of the camera.
- Do not stage real falls for testing — use the dataset clips.

## Dataset

Kwolek, B., & Kepski, M. (2014). Human fall detection on embedded platform using depth maps and wireless accelerometer.
*Computer Methods and Programs in Biomedicine, 117*(3), 489–501. https://fenix.ur.edu.pl/mkepski/ds/uf.html
