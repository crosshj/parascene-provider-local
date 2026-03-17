### `/api` pattern

- **GET `/api`**  
  - Auth via `Authorization: Bearer <PARASCENE_API_KEY>`.  
  - Otherwise → capabilities JSON: `{ status, last_check_at, methods }`.

- **POST `/api`**
  - Auth via `Authorization: Bearer <PARASCENE_API_KEY>`.    
  - Body: `{ method, args }`.  
  - **Start** (no `args.job_id`):  
    - Generator returns JSON like `{ status, job_id }`.  
    - `/api` returns that JSON; use HTTP 202 while `status !== "succeeded"`.  
  - **Poll** (`args.job_id` present):  
    - Same POST shape, with `args.job_id` set.  
    - Generator returns either in‑progress JSON (HTTP 202) or the final binary/JSON result (HTTP 200).


