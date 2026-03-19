#!/bin/bash
# Initialises the MongoDB replica set.
# Run this ONCE after all three nodes are up and healthy.
# Run from machine1 (where mongo1 is running).

set -e

# Load env vars
ENV_FILE="$(dirname "$0")/../.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Copy .env.example to .env and fill in values first."
  exit 1
fi

source "$ENV_FILE"

: "${MONGO_ROOT_USERNAME:?MONGO_ROOT_USERNAME not set in .env}"
: "${MONGO_ROOT_PASSWORD:?MONGO_ROOT_PASSWORD not set in .env}"
: "${MONGO_REPLICA_SET:?MONGO_REPLICA_SET not set in .env}"
: "${MONGO1_HOST:?MONGO1_HOST not set in .env}"
: "${MONGO2_HOST:?MONGO2_HOST not set in .env}"
: "${MONGO3_HOST:?MONGO3_HOST not set in .env}"

echo "Waiting for mongo1 to be ready..."
until docker exec $(docker compose -f "$(dirname "$0")/../machine1/docker-compose.yml" ps -q mongo1) \
  mongosh --quiet \
  -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.adminCommand('ping').ok" 2>/dev/null | grep -q "1"; do
  sleep 2
done
echo "mongo1 is ready."

echo "Initialising replica set ${MONGO_REPLICA_SET}..."

docker exec $(docker compose -f "$(dirname "$0")/../machine1/docker-compose.yml" ps -q mongo1) \
  mongosh \
  -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --eval "
    var cfg = {
      _id: '${MONGO_REPLICA_SET}',
      members: [
        {
          _id: 0,
          host: '${MONGO1_HOST}:27017',
          priority: 1          // lowest priority — local machine, may go offline
        },
        {
          _id: 1,
          host: '${MONGO2_HOST}:27017',
          priority: 2          // preferred primary — always-on Linode
        },
        {
          _id: 2,
          host: '${MONGO3_HOST}:27017',
          priority: 1.5
        }
      ]
    };

    var result = rs.initiate(cfg);
    print(JSON.stringify(result));
  "

echo ""
echo "Replica set initialised. Checking status in 5 seconds..."
sleep 5

docker exec $(docker compose -f "$(dirname "$0")/../machine1/docker-compose.yml" ps -q mongo1) \
  mongosh --quiet \
  -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --eval "rs.status().members.forEach(m => print(m.name, '-', m.stateStr))"

echo ""
echo "Done. Update MONGODB_URL in your .env to the replica set connection string:"
echo "  mongodb://${MONGO_ROOT_USERNAME}:${MONGO_ROOT_PASSWORD}@${MONGO1_HOST}:27017,${MONGO2_HOST}:27017,${MONGO3_HOST}:27017/${MONGO_DATABASE:-pms}?replicaSet=${MONGO_REPLICA_SET}&authSource=admin"
