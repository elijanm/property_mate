# Watch mode (re-runs on file change)                                                                                                                                                                       
  npm run test                                                                                                                                                                                                
                                                                                                                                                                                                              
  # Single run (CI)                           
  npm run test:run                                                                                                                                                                                            
                                                                                                                                                                                                              
  # With coverage                                                                                                                                                                                             
  npm run test:coverage                                                                                                                                                                                       
                                                                                                                                                                                                              
  Backend (apps/backend/):                                                                                                                                                                                    
  pytest apps/backend/tests/ -v --asyncio-mode=auto                                                                                                                                                           
                                                                                                                                                                                                              
  From the repo root:                              
  # Frontend                                                                                                                                                                                                  
  cd apps/frontend && npm run test                          
                                                                                                                                                                                                              
  # Backend                                                                                                                                                                                                   
  cd apps/backend && pytest tests/ -v --asyncio-mode=auto                                                                                                                                                     
                                                                                                                                                                                                              
  # Specific test file                                                                                                                                                                                        
  pytest apps/backend/tests/unit/test_invoice_service.py -v --asyncio-mode=auto                                                                                                                               
                      
  # Specific test by name                                                                                                                                                                                     
  pytest apps/backend/tests/ -v -k "test_create_lease" --asyncio-mode=auto
                                              
  The frontend uses Vitest (vite-native, no separate config needed). The backend uses pytest + pytest-asyncio.


  # Run with real MongoDB + keep data (best for inspecting results in the app UI)                                                                                                                             
  pytest -v --real-db --keep-data tests/api/test_billing_e2e_api.py                                                                                                                                           
                                                                                                                                                                                                              
  # Run a specific test and keep data                                                                                                                                                                         
  pytest -v --real-db --keep-data -k test_billing_seed_12_months                                                                                                                                              
                                                                                                                                                                                                              
  # Keep data with in-memory DB (only useful for within-process debugging)                                                                                                                                    
  pytest -v --keep-data -k test_create_lease                                                                                                                                                                  
                                                                                                                                                                                                              
  What --real-db --keep-data does:                                                                                                                                                                            
  - Connects to your real MongoDB at MONGODB_URL (default mongodb://localhost:27017) using the pms_test database                                                                                              
  - Skips the teardown that drops all collections after the test                                                                                                                                              
  - Prints a banner showing where the data lives so you can open it in the UI or Compass                                                                                                                      
                                                                                                                                                                                                              
  Without --keep-data: every test cleans up its collections after it runs (default behaviour).
 # for data
  docker exec -it docker-backend-1 bash -c "cd /app && PYTHONPATH=. MONGODB_URL=mongodb://mongo:27017 python -m tests.seed.seed --months 18 --seed 99 --lease-start 2024-01"
┌──────────────────┬─────────────────────┬──────────────────────────────┐                                                                                                                                   
  │       Flag       │       Default       │         Description          │                               
  ├──────────────────┼─────────────────────┼──────────────────────────────┤                                                                                                                                   
  │ --org-id         │ org_seed_001        │ org_id on all seeded records │                               
  ├──────────────────┼─────────────────────┼──────────────────────────────┤
  │ --owner-email    │ owner@seedpms.co.ke │ Owner login email            │                                                                                                                                   
  ├──────────────────┼─────────────────────┼──────────────────────────────┤                                                                                                                                   
  │ --owner-password │ Seed1234!           │ Owner login password         │                                                                                                                                   
  ├──────────────────┼─────────────────────┼──────────────────────────────┤                                                                                                                                   
  │ --property-name  │ Sunrise Apartments  │ Property display name        │                               
  ├──────────────────┼─────────────────────┼──────────────────────────────┤                                                                                                                                   
  │ --db             │ $MONGO_DB env       │ Target MongoDB database      │                               
  ├──────────────────┼─────────────────────┼──────────────────────────────┤                                                                                                                                   
  │ --drop           │ off                 │ Drop DB before seeding       │                               
  └──────────────────┴─────────────────────┴──────────────────────────────┘                                                                                                                                   
                                                                                                          
  Example with a fresh org:                                                                                                                                                                                   
  python tests/seed/seed.py --drop \                                                                      
    --org-id org_client_abc \                                                                                                                                                                                 
    --owner-email owner@abc.co.ke \                                                                       
    --owner-password "Client123!" \                                                                                                                                                                           
    --property-name "ABC Heights" \
    --months 18                  