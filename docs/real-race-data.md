# Real-race data: Gustav Iden, IRONMAN World Championship Kona 2022

The running-leg demo on real race data uses the telemetry of **Gustav Iden**
during the marathon of the **IRONMAN World Championship Kona 2022**
(8 October 2022), published by **Entalpi**:

- Dataset repository: <https://github.com/entalpi-no/kona-2022>
- CSV: <https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv>

## Licence and attribution

The dataset is licensed **CC BY-NC 4.0**:

- **Attribution:** credit Entalpi as the source of the telemetry and Gustav
  Iden as the athlete, with the event and date (IRONMAN World Championship
  Kona 2022).
- **Non-commercial:** the raw dataset may not be included in, served from, or
  redistributed by a commercial use without authorization from Entalpi.

The raw CSV therefore **lives in an ignored directory (`data/`) and is never
committed** to this repository, bundled into `public/`, or served by the app.
Only the download script, this attribution document, and derived, verified
fixtures may be versioned.

## Downloading the dataset

Run the versioned download script with the source URL and destination path
(no credentials, nothing else is fetched):

```sh
node scripts/download-kona-2022.mjs \
  https://raw.githubusercontent.com/entalpi-no/kona-2022/main/gustav_iden_copyright_entalpi_as.csv \
  data/kona-2022/gustav_iden.csv
```

The script:

1. Requires exactly two arguments: source URL and destination path
   (`--force` optionally allows overwriting an existing file).
2. Refuses to overwrite an existing destination unless `--force` is passed.
3. Fails with a non-zero exit code on network error, non-200 status, an empty
   file, or a first line that is not exactly
   `datetime,latitude,longitude,speed,elevation,heartrate,cadence,stride_length`.
4. Writes the CSV plus a `data/kona-2022/gustav_iden.csv.provenance.json`
   record containing `sourceUrl`, `downloadedAt` (ISO 8601 UTC), `sha256`,
   `license: "CC BY-NC 4.0"`, `athlete: "Gustav Iden"` and
   `event: "IRONMAN World Championship Kona 2022"`.

Keep the provenance record next to the CSV: it is the audit trail that ties
any derived fixture back to the verified source snapshot.

See `docs/research/validacion-carrera-real-kona-2022.md` for the full
validation plan (window selection, normalization rules, and quality policy).
