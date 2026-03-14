---                                                                                                                                                                                                         
  Testing Device Registration & SSH Setup                                                                                                                                                                     
                                                                                                                                                                                                              
  1. Prerequisites — create a device type                                                                                                                                                                     
                                                                                                                                                                                                              
  POST /api/v1/device-types                                                                                                                                                                                   
  Authorization: Bearer <token>                                                                                                                                                                               
                                                                                                                                                                                                              
  {                                                                                                                                                                                                           
    "name": "Edge Gateway Node",                                                                                                                                                                              
    "category": "gateway",                                                                                                                                                                                    
    "capabilities": ["telemetry", "ssh", "rpc", "ota"],                                                                                                                                                       
    "description": "Linux edge node with SSH support"                                                                                                                                                         
  }                                                                                                                                                                                                           
  # → save the returned "id" as DEVICE_TYPE_ID                                                                                                                                                                
                                                                                                                                                                                                              
  For a non-SSH device omit "ssh" from capabilities.                                                                                                                                                          
                                                                                                                                                                                                              
  ---                                                                                                                                                                                                         
  2. Register the device — POST /api/v1/sync/register-device                                                                                                                                                  
                                                                                                                                                                                                              
  POST /api/v1/sync/register-device                                                                                                                                                                           
  Authorization: Bearer <token>   # role: owner | agent | superadmin                                                                                                                                          
                                                                                                                                                                                                              
  {                                                                                                                                                                                                           
    "org_id": "your-org-id",           # superadmin only; omit for normal users                                                                                                                               
    "org_name": "Acme Corp",                                                                                                                                                                                  
    "property_id": "prop-abc",                                                                                                                                                                                
    "property_name": "Main Building",                                                                                                                                                                         
    "device_uid": "gw-eth-001",        # globally unique hardware ID                                                                                                                                        
    "device_name": "Lobby Gateway",                                                                                                                                                                           
    "device_type_id": "<DEVICE_TYPE_ID>",                                                                                                                                                                   
                                                                                                                                                                                                              
    # Optional:                                                                                                                                                                                             
    "unit_id": "unit-101",             # creates a ThingsBoard Asset for the unit                                                                                                                             
    "unit_name": "Unit 101",                                                                                                                                                                                  
    "serial_number": "SN-20240101",
    "tags": ["floor-1", "lobby"]                                                                                                                                                                              
  }                                                                                                                                                                                                           
                                                                                                                                                                                                              
  Response — save these values, most are shown only once:                                                                                                                                                     
                                                                                                                                                                                                            
  ┌───────────────────────┬───────────┬─────────────────────────────────────────────┐                                                                                                                         
  │         Field         │  Store?   │                     Use                     │                                                                                                                       
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤                                                                                                                         
  │ mqtt_password         │ ✅ once   │ Device authenticates to EMQX                │                                                                                                                       
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤
  │ mqtt_username         │ keep      │ = device_uid                                │                                                                                                                         
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤
  │ mqtt_client_id        │ keep      │ = d:{device_uid}                            │                                                                                                                         
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤                                                                                                                         
  │ mqtt_broker_host/port │ keep      │ EMQX address                                │
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤                                                                                                                         
  │ tb_access_token       │ ✅ once   │ Device pushes telemetry to ThingsBoard      │                                                                                                                       
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤                                                                                                                         
  │ tb_device_id          │ keep      │ ThingsBoard dashboard link                  │
  ├───────────────────────┼───────────┼─────────────────────────────────────────────┤                                                                                                                         
  │ ssh_setup             │ see below │ Only present when capability includes "ssh" │                                                                                                                       
  └───────────────────────┴───────────┴─────────────────────────────────────────────┘                                                                                                                         
                                                                                                                                                                                                            
  Response status:                                                                                                                                                                                            
  - "provisioned" — all systems registered ✅                                                                                                                                                               
  - "partial" — MongoDB/MQTT ready, ThingsBoard sync failed (device still works for MQTT, retry via PATCH /devices/{id}/sync)                                                                                 
   
  ---                                                                                                                                                                                                         
  3. SSH-capable devices — ssh_setup block                                                                                                                                                                  
                                                                                                                                                                                                              
  When the device type has "ssh" in capabilities, the registration response includes:                                                                                                                       
                                                                                                                                                                                                              
  "ssh_setup": {                                                                                                                                                                                            
    "headscale_login_server": "http://your-headscale:8085",                                                                                                                                                   
    "headscale_namespace": "pms-devices",                                                                                                                                                                     
    "preauth_key": "abc123...",                                                                                                                                                                               
    "preauth_key_expires_in": "24 hours (single-use)",                                                                                                                                                        
    "tailscale_install_cmd": "curl -fsSL https://tailscale.com/install.sh | sh",                                                                                                                              
    "tailscale_register_cmd": "tailscale up --login-server=... --authkey=abc123... --hostname=gw-eth-001",                                                                                                    
    "setup_steps": [ "1. Install ...", "2. Register ...", "3-7. ..." ]                                                                                                                                        
  }                                                                                                                                                                                                           
                                                                                                                                                                                                              
  Run on the physical device:                                                                                                                                                                                 
                                                                                                                                                                                                            
  # Step 1 — install Tailscale                                                                                                                                                                                
  curl -fsSL https://tailscale.com/install.sh | sh                                                                                                                                                          
                                                                                                                                                                                                              
  # Step 2 — join the Headscale network (use the key from ssh_setup)                                                                                                                                          
  tailscale up \                                                                                                                                                                                              
    --login-server=http://<headscale-host>:8085 \                                                                                                                                                             
    --authkey=<preauth_key> \                                                                                                                                                                               
    --hostname=gw-eth-001                                                                                                                                                                                     
                                                                                                                                                                                                              
  Step 3 — confirm the node appeared and link it:                                                                                                                                                             
                                                                                                                                                                                                              
  # Confirm node is visible                                                                                                                                                                                   
  GET /api/v1/tailscale/nodes                                                                                                                                                                                 
                                                                                                                                                                                                              
  # Link Headscale node to the PMS device record                                                                                                                                                              
  POST /api/v1/tailscale/nodes/auto-register                                                                                                                                                                  
  {                                                                                                                                                                                                           
    "node_id": "<headscale_node_id>",   # from the list above
    "entity_type": "device",                                                                                                                                                                                  
    "entity_id": "<device_id>"          # from registration response                                                                                                                                        
  }                                                                                                                                                                                                           
                                                                                                                                                                                                            
  Step 4 — request SSH access (time-limited):                                                                                                                                                                 
                                                                                                                                                                                                            
  # 4a. Request                                                                                                                                                                                               
  POST /api/v1/ssh-requests
  {                                                                                                                                                                                                           
    "target_type": "device",                                                                                                                                                                                
    "target_id": "<device_id>",                                                                                                                                                                               
    "reason": "Debugging telemetry issue",                                                                                                                                                                  
    "requested_duration_m": 60,                                                                                                                                                                               
    "requester_tailscale_ip": "<your tailscale IP>"
  }                                                                                                                                                                                                           
  # → returns request_id                                                                                                                                                                                    
                                                                                                                                                                                                              
  # 4b. Owner/superadmin approves (inserts Headscale ACL rule)                                                                                                                                                
  POST /api/v1/ssh-requests/<request_id>/approve                                                                                                                                                              
                                                                                                                                                                                                              
  # 4c. SSH in                                                                                                                                                                                                
  ssh root@<device_tailscale_ip>
                                                                                                                                                                                                              
  # 4d. Revoke early if needed                                                                                                                                                                                
  POST /api/v1/ssh-requests/<request_id>/revoke
                                                                                                                                                                                                              
  ---                                                                                                                                                                                                       
  4. Refresh SSH key for existing device
                                                                                                                                                                                                              
  The pre-auth key is single-use. If the device hasn't joined yet or you need a new key:
                                                                                                                                                                                                              
  GET /api/v1/devices/<device_id>/ssh-setup                                                                                                                                                                 
                                                                                                                                                                                                              
  Returns a freshly generated pre-auth key (valid 24 h) plus all the same setup instructions.         



⏺ The test script is at apps/iot/tests/integration/test_device_registration.py. Here's what it covers:                                                                                                        
                                                            
  ┌─────┬───────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────┐                                                                       
  │  #  │         Test          │                                           What it checks                                            │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 1   │ Connectivity          │ GET /sync/connectivity — all 7 services green                                                       │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 2   │ Auth login            │ JWT token + org_id returned                                                                         │                                                                       
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 3   │ Create device types   │ SSH-capable + plain type; verifies id is a string (not {})                                          │                                                                       
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 4   │ Register SSH device   │ Full provisioning: MQTT creds, TB fields, ssh_setup block with preauth_key + tailscale_register_cmd │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 5   │ Register plain device │ No ssh_setup returned                                                                               │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 6   │ Duplicate UID → 409   │ Re-registering same device_uid returns Conflict                                                     │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 7   │ GET device            │ Fields correct, mqtt_password_hash never exposed                                                    │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 8   │ List devices          │ Pagination envelope                                                                                 │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 9   │ SSH setup endpoint    │ GET /devices/{id}/ssh-setup returns fresh pre-auth key                                              │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 10  │ SSH setup (plain)     │ Returns ssh_supported: false + message                                                              │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 11  │ MQTT TCP probe        │ Port 1883 is open                                                                                   │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 12  │ MQTT auth hook        │ Calls IoT service's /internal/auth/device — verifies credentials accepted                           │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 13  │ TB telemetry push     │ Pushes telemetry via tb_access_token                                                                │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 14  │ TB idempotency        │ Second device same property → provision_org_tenant step is skipped (cache hit)                      │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 15  │ Rotate credentials    │ New password differs from original                                                                  │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 16  │ Update device         │ PATCH name/description/tags                                                                         │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 17  │ Headscale nodes       │ List endpoint reachable                                                                             │
  ├─────┼───────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                                       
  │ 18  │ Cleanup               │ Soft-delete test devices; GET after delete → 404                                                    │
  └─────┴───────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────┘                                                                       
                                                            
  Run it:                                                                                                                                                                                                     
   
  # Standalone (no pytest dependency)                                                                                                                                                                         
  cd apps/iot                                               
  python tests/integration/test_device_registration.py                                                                                                                                                        
   
  # Or via pytest                                                                                                                                                                                             
  python -m pytest tests/integration/test_device_registration.py -v --tb=short
                                                                                                                                                                                                              
  # Override endpoints
  IOT_BASE_URL=http://localhost:8020/api/v1 \                                                                                                                                                                 
  OWNER_EMAIL=admin@yourorg.com \                                                                                                                                                                             
  OWNER_PASSWORD=yourpass \                                                                                                                                                                                   
  python tests/integration/test_device_registration.py   



  ---                                                       
  To activate mTLS                                                                                                                                                                                            
                                                            
  # 1. Generate CA + server certs
  bash scripts/gen-certs.sh                                                                                                                                                                                   
                                                                                                                                                                                                              
  # 2. Export CA into .env (multiline → single-line \n escaping)                                                                                                                                              
  export IOT_CA_CERT_PEM=$(awk 'NF{sub(/\r/,""); printf "%s\\n",$0}' infra/docker/certs/ca.crt)                                                                                                               
  export IOT_CA_KEY_PEM=$(awk 'NF{sub(/\r/,""); printf "%s\\n",$0}' infra/docker/certs/ca.key)                                                                                                                
                                                            
  # 3. Restart                                                                                                                                                                                                
  docker compose -f infra/docker/docker-compose.yml restart iot-service emqx
                                                                                                                                                                                                              
  # 4. Test — server presents its cert, client verifies against CA                                                                                                                                            
  openssl s_client -connect localhost:8883 -CAfile infra/docker/certs/ca.crt                                                                                                                                  
                                                                                                                                                                                                              
  # 5. Connect a device with its issued cert (from register-device response)                                                                                                                                  
  mosquitto_pub -h localhost -p 8883 \                                                                                                                                                                        
    --cafile infra/docker/certs/ca.crt \                                                                                                                                                                      
    --cert /path/to/device.crt \                            
    --key  /path/to/device.key \                                                                                                                                                                              
    -t "pms/<org>/<prop>/<uid>/telemetry" -m '{"temp":22}'  



Additional Features Worth Adding                          
                                                                                                                                                                                                              
  Beyond what's already planned, these would round out the platform:
                                                                                                                                                                                                              
  1. Live Telemetry Dashboard (per device)                                                                                                                                                                    
  Real-time charts via MQTT → WebSocket bridge. Temperature gauge, lock state toggle, battery arc — rendered with recharts. Useful for meter readings and sensors.                                            
                                                                                                                                                                                                              
  2. Floor Plan Device Map                                                                                                                                                                                    
  Upload a property floor plan image; drag-drop devices onto it. Shows live status dots. Click device → opens detail slide-over. Stored as {x_pct, y_pct} on the device record.                               
                                                                                                                                                                                                              
  3. Scheduled Commands / Automations                                                                                                                                                                         
  "Every day at 06:00, send unlock to all gate locks" — cron-style scheduler backed by APScheduler in the IoT service. Useful for access control.                                                             
                                                                                                                                                                                                              
  4. Device Shadow / Twin State                                                                                                                                                                               
  Maintain desired vs reported state per device (e.g., desired thermostat = 22°C, reported = 24°C). Backend stores desired_state and reported_state dicts. Device syncs on connect.                           
                                                                                                                                                                                                              
  5. QR Code / Label Printer                                
  Generate a printable QR code label per device (device_uid + org_id encoded). Field technician scans it to pull up the device record on mobile. Label includes property, unit, install date.                 
                                                                                                                                                                                                              
  6. Field Technician Mobile View (PWA)                                                                                                                                                                       
  Responsive page at /tech/devices/:qr_token — shows device status, allows sending a command, uploading a photo, and completing an inspection checklist. No login required if token is valid.                 
                                                                                                                                                                                                              
  7. Predictive Maintenance                                                                                                                                                                                   
  Analyse telemetry trends (7-day moving average). If vibration is trending up on a pump, flag it before failure. Backed by a simple linear regression in the alert rule evaluation service.                  
                                                                                                                                                                                                              
  8. Energy Analytics for Smart Meters                                                                                                                                                                        
  Aggregate power_kw telemetry into daily/monthly kWh. Link to utility invoices. Show cost per unit vs meter reading to close the gap between IoT and billing.                                                
                                                                                                                                                                                                              
  9. Access Schedules for Smart Locks                                                                                                                                                                         
  Define per-unit lock schedules (open 08:00–18:00 weekdays, locked otherwise). Backend pushes schedule to lock via MQTT retained message. Device enforces locally.                                           
                                                                                                                                                                                                              
  10. Vendor/Installer Portal                                                                                                                                                                                 
  Service provider logs in, sees only devices assigned to them, can view telemetry and submit service reports with photo evidence — directly tied to maintenance tickets. 