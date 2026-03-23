"""
Abstract data source definitions + concrete implementations.

Available sources
-----------------
  S3DataSource              — S3 / MinIO bucket (single file or prefix)
  URLDataSource             — HTTP/HTTPS URL (file, ZIP, JSON API)
  UploadedFileDataSource    — file uploaded via the training API
  InMemoryDataSource        — pass data directly (tests / notebooks)
  LocalFileDataSource       — path on the local filesystem or mounted volume
  MongoDBDataSource         — query a MongoDB collection, returns list of dicts
  PostgreSQLDataSource      — SQL query against a PostgreSQL database
  SQLDataSource             — generic SQL via SQLAlchemy (any RDBMS)
  HuggingFaceDataSource     — Hugging Face Hub dataset
  KafkaDataSource           — consume N messages from a Kafka topic
  GCSDataSource             — Google Cloud Storage blob / prefix
  AzureBlobDataSource       — Azure Blob Storage container / blob
  FTPDataSource             — FTP / SFTP remote file
  PaginatedAPIDataSource    — paginated REST API (fetches all pages)
  RedisDataSource           — Redis list, set, sorted-set, or key pattern
  UrlDatasetDataSource      — URL dataset cached in S3, refreshed on a schedule

Example
-------
    class MyTrainer(BaseTrainer):
        data_source = MongoDBDataSource(
            uri="mongodb://localhost:27017",
            database="pms",
            collection="leases",
            query={"status": "active"},
            projection={"tenant_id": 1, "rent_amount": 1, "status": 1},
        )
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
import logging
import asyncio
import sys
logger = logging.getLogger("runner")
logger.setLevel(logging.INFO)
logger.addHandler(logging.StreamHandler(sys.stdout))

# ── Abstract base ─────────────────────────────────────────────────────────────

class DataSource(ABC):
    """Abstract base for all data sources."""

    @abstractmethod
    async def load(self, **kwargs) -> Any:
        """Load raw data. Returns data in whatever format the trainer expects."""
        ...

    @property
    @abstractmethod
    def source_type(self) -> str:
        ...

    def describe(self) -> Dict:
        return {"type": self.source_type}


# ── S3 / MinIO ────────────────────────────────────────────────────────────────

@dataclass
class S3DataSource(DataSource):
    """
    Load training data from an S3 / MinIO bucket.

    If ``key`` is a single object key the raw bytes are returned.
    If ``key`` is a prefix all matching objects are downloaded and returned
    as a list of bytes.

        data_source = S3DataSource(bucket="pms-ml", key="datasets/churn.csv")
        data_source = S3DataSource(bucket="pms-ml", key="datasets/images/")
    """
    bucket: str
    key: str
    endpoint_url: Optional[str] = None
    access_key: Optional[str] = None
    secret_key: Optional[str] = None
    region: str = "us-east-1"

    @property
    def source_type(self) -> str:
        return "s3"

    async def load(self, **kwargs) -> bytes | List[bytes]:
        import aioboto3
        from app.core.config import settings as _s

        endpoint = self.endpoint_url or _s.S3_ENDPOINT_URL
        ak = self.access_key or _s.S3_ACCESS_KEY
        sk = self.secret_key or _s.S3_SECRET_KEY

        session = aioboto3.Session()
        async with session.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=ak,
            aws_secret_access_key=sk,
            region_name=self.region,
        ) as s3:
            try:
                resp = await s3.get_object(Bucket=self.bucket, Key=self.key)
                return await resp["Body"].read()
            except Exception:
                pass
            paginator = s3.get_paginator("list_objects_v2")
            results: List[bytes] = []
            async for page in paginator.paginate(Bucket=self.bucket, Prefix=self.key):
                for obj in page.get("Contents", []):
                    r = await s3.get_object(Bucket=self.bucket, Key=obj["Key"])
                    results.append(await r["Body"].read())
            return results

    def describe(self) -> Dict:
        return {"type": "s3", "bucket": self.bucket, "key": self.key}


# ── HTTP / HTTPS URL ──────────────────────────────────────────────────────────

@dataclass
class URLDataSource(DataSource):
    """
    Download training data from any HTTP/HTTPS URL.

    Supports basic auth, custom headers, and bearer tokens.

        data_source = URLDataSource(url="https://example.com/data.csv")
        data_source = URLDataSource(
            url="https://api.example.com/export",
            headers={"Authorization": "Bearer TOKEN"},
        )
    """
    url: str
    headers: Dict[str, str] = field(default_factory=dict)
    auth: Optional[tuple] = None          # (username, password) for HTTP Basic Auth
    timeout: int = 120

    @property
    def source_type(self) -> str:
        return "url"

    async def load(self, **kwargs) -> bytes:
        from app.core.safe_http import SafeHttpClient, HostNotAllowedError
        try:
            client = SafeHttpClient(connect_timeout=10.0, read_timeout=float(self.timeout))
            resp = client.get(self.url, headers=self.headers)
            resp.raise_for_status()
            return resp.content
        except HostNotAllowedError as exc:
            raise PermissionError(
                f"URLDataSource blocked: {exc}. "
                "If this host is required, ask your admin to allowlist it."
            ) from exc

    def describe(self) -> Dict:
        return {"type": "url", "url": self.url}


# ── Uploaded file (API injection) ─────────────────────────────────────────────

@dataclass
class UploadedFileDataSource(DataSource):
    """
    Bytes are injected at training time via the ``/training/start-with-data``
    endpoint. Use this when training data changes per run and cannot be
    stored centrally.

        data_source = UploadedFileDataSource()
    """
    _data: Optional[bytes] = field(default=None, repr=False)

    @property
    def source_type(self) -> str:
        return "file"

    def inject(self, data: bytes) -> None:
        self._data = data

    async def load(self, **kwargs) -> bytes:
        data = kwargs.get("injected_data") or self._data
        if data is None:
            raise ValueError(
                "No file data injected — use POST /training/start-with-data "
                "to upload training data alongside the trigger."
            )
        return data

    def describe(self) -> Dict:
        return {"type": "file"}


# ── Local filesystem ──────────────────────────────────────────────────────────

@dataclass
class LocalFileDataSource(DataSource):
    """
    Read a file (or all files in a directory) from the local filesystem /
    a mounted Docker volume.

        data_source = LocalFileDataSource(path="/data/train.csv")
        data_source = LocalFileDataSource(path="/data/images/", glob="*.jpg")
    """
    path: str
    glob: str = "*"                   # only used when path is a directory
    encoding: Optional[str] = None    # set to "utf-8" to return str instead of bytes

    @property
    def source_type(self) -> str:
        return "local_file"

    async def load(self, **kwargs) -> bytes | str | List[bytes]:
        import aiofiles
        from pathlib import Path

        p = Path(self.path)
        if p.is_file():
            mode = "r" if self.encoding else "rb"
            async with aiofiles.open(p, mode, encoding=self.encoding) as f:
                return await f.read()
        if p.is_dir():
            results: List[bytes] = []
            for child in sorted(p.glob(self.glob)):
                if child.is_file():
                    async with aiofiles.open(child, "rb") as f:
                        results.append(await f.read())
            return results
        raise FileNotFoundError(f"Path not found: {self.path}")

    def describe(self) -> Dict:
        return {"type": "local_file", "path": self.path}


# ── In-memory (tests / notebooks) ────────────────────────────────────────────

@dataclass
class InMemoryDataSource(DataSource):
    """
    Pass data directly — useful for built-in datasets, tests, and notebooks.

        data_source = InMemoryDataSource()   # preprocess() loads the dataset itself
        data_source = InMemoryDataSource(data=my_dataframe)
    """
    data: Any = None

    @property
    def source_type(self) -> str:
        return "memory"

    async def load(self, **kwargs) -> Any:
        return self.data

    def describe(self) -> Dict:
        return {"type": "memory"}


# ── MongoDB ───────────────────────────────────────────────────────────────────

@dataclass
class MongoDBDataSource(DataSource):
    """
    Query a MongoDB collection and return results as a list of dicts.

    Uses the PMS MongoDB connection by default (set uri=None). Specify a
    different ``uri`` to connect to any other MongoDB instance.

        data_source = MongoDBDataSource(
            database="pms",
            collection="leases",
            query={"status": "active"},
            projection={"tenant_id": 1, "rent_amount": 1, "_id": 0},
            limit=50000,
        )
    """
    database: str
    collection: str
    query: Dict = field(default_factory=dict)
    projection: Optional[Dict] = None
    sort: Optional[List] = None       # e.g. [("created_at", -1)]
    limit: int = 0                    # 0 = no limit
    uri: Optional[str] = None         # defaults to MONGODB_URL from settings

    @property
    def source_type(self) -> str:
        return "mongodb"

    async def load(self, **kwargs) -> List[Dict]:
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.core.config import settings as _s

        client = AsyncIOMotorClient(self.uri or _s.MONGODB_URL)
        try:
            coll = client[self.database][self.collection]
            cursor = coll.find(self.query, self.projection or {})
            if self.sort:
                cursor = cursor.sort(self.sort)
            if self.limit:
                cursor = cursor.limit(self.limit)
            return await cursor.to_list(length=self.limit or None)
        finally:
            client.close()

    def describe(self) -> Dict:
        return {
            "type": "mongodb",
            "database": self.database,
            "collection": self.collection,
            "query": self.query,
            "limit": self.limit,
        }


# ── PostgreSQL ────────────────────────────────────────────────────────────────

@dataclass
class PostgreSQLDataSource(DataSource):
    """
    Execute a SQL query against a PostgreSQL database and return rows as
    a list of dicts.

        data_source = PostgreSQLDataSource(
            dsn="postgresql://user:pass@host:5432/dbname",
            query="SELECT * FROM invoices WHERE status = 'overdue'",
        )
    """
    dsn: str
    query: str
    params: Optional[tuple] = None    # positional query parameters

    @property
    def source_type(self) -> str:
        return "postgresql"

    async def load(self, **kwargs) -> List[Dict]:
        try:
            import asyncpg
        except ImportError:
            raise ImportError("asyncpg is required for PostgreSQLDataSource: pip install asyncpg")

        conn = await asyncpg.connect(self.dsn)
        try:
            rows = await conn.fetch(self.query, *(self.params or ()))
            return [dict(r) for r in rows]
        finally:
            await conn.close()

    def describe(self) -> Dict:
        return {"type": "postgresql", "query": self.query[:120]}


# ── Generic SQL (SQLAlchemy) ──────────────────────────────────────────────────

@dataclass
class SQLDataSource(DataSource):
    """
    Execute a SQL query via SQLAlchemy — works with any RDBMS
    (MySQL, SQLite, MSSQL, Oracle, etc.).

        data_source = SQLDataSource(
            connection_string="mysql+pymysql://user:pass@host/dbname",
            query="SELECT * FROM payments WHERE paid_at >= '2024-01-01'",
        )
    """
    connection_string: str
    query: str
    chunksize: Optional[int] = None   # if set, returns list of DataFrames

    @property
    def source_type(self) -> str:
        return "sql"

    async def load(self, **kwargs) -> Any:
        import asyncio
        try:
            import pandas as pd
            from sqlalchemy import create_engine, text
        except ImportError:
            raise ImportError("pandas and sqlalchemy are required for SQLDataSource")

        def _read():
            engine = create_engine(self.connection_string)
            with engine.connect() as conn:
                if self.chunksize:
                    return pd.read_sql(text(self.query), conn, chunksize=self.chunksize)
                return pd.read_sql(text(self.query), conn)

        return await asyncio.get_event_loop().run_in_executor(None, _read)

    def describe(self) -> Dict:
        return {"type": "sql", "query": self.query[:120]}


# ── Hugging Face Hub ──────────────────────────────────────────────────────────

@dataclass
class HuggingFaceDataSource(DataSource):
    """
    Load a dataset from the Hugging Face Hub (or a local HF dataset cache).

        data_source = HuggingFaceDataSource(
            dataset_name="imdb",
            split="train",
        )
        data_source = HuggingFaceDataSource(
            dataset_name="squad",
            split="train[:10%]",
            config_name="plain_text",
        )
    """
    dataset_name: str
    split: str = "train"
    config_name: Optional[str] = None
    token: Optional[str] = None       # HF API token for private datasets
    cache_dir: Optional[str] = None

    @property
    def source_type(self) -> str:
        return "huggingface"

    async def load(self, **kwargs) -> Any:
        import asyncio
        try:
            from datasets import load_dataset
        except ImportError:
            raise ImportError("datasets is required for HuggingFaceDataSource: pip install datasets")

        def _load():
            return load_dataset(
                self.dataset_name,
                self.config_name,
                split=self.split,
                token=self.token,
                cache_dir=self.cache_dir,
            )

        return await asyncio.get_event_loop().run_in_executor(None, _load)

    def describe(self) -> Dict:
        return {
            "type": "huggingface",
            "dataset": self.dataset_name,
            "split": self.split,
        }


# ── Kafka ─────────────────────────────────────────────────────────────────────

@dataclass
class KafkaDataSource(DataSource):
    """
    Consume up to ``max_messages`` messages from a Kafka topic and return
    them as a list of decoded values.

        data_source = KafkaDataSource(
            bootstrap_servers="kafka:9092",
            topic="pms.payments",
            group_id="ml-training-consumer",
            max_messages=100000,
        )
    """
    bootstrap_servers: str
    topic: str
    group_id: str = "pms-ml-training"
    max_messages: int = 10000
    timeout_seconds: float = 30.0
    value_deserializer: str = "json"   # "json" | "bytes" | "utf8"
    from_beginning: bool = True

    @property
    def source_type(self) -> str:
        return "kafka"

    async def load(self, **kwargs) -> List[Any]:
        import asyncio
        try:
            from aiokafka import AIOKafkaConsumer
        except ImportError:
            raise ImportError("aiokafka is required for KafkaDataSource: pip install aiokafka")
        import json

        def _deserialize(v: bytes) -> Any:
            if self.value_deserializer == "json":
                return json.loads(v)
            if self.value_deserializer == "utf8":
                return v.decode("utf-8")
            return v

        consumer = AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=self.bootstrap_servers,
            group_id=self.group_id,
            auto_offset_reset="earliest" if self.from_beginning else "latest",
            enable_auto_commit=False,
        )
        await consumer.start()
        messages: List[Any] = []
        try:
            async for msg in consumer:
                messages.append(_deserialize(msg.value))
                if len(messages) >= self.max_messages:
                    break
        except asyncio.TimeoutError:
            pass
        finally:
            await consumer.stop()
        return messages

    def describe(self) -> Dict:
        return {
            "type": "kafka",
            "bootstrap_servers": self.bootstrap_servers,
            "topic": self.topic,
            "max_messages": self.max_messages,
        }


# ── Google Cloud Storage ──────────────────────────────────────────────────────

@dataclass
class GCSDataSource(DataSource):
    """
    Download a blob or all blobs under a prefix from Google Cloud Storage.

    Authentication: set ``GOOGLE_APPLICATION_CREDENTIALS`` env var to a
    service-account JSON key path, or pass ``credentials_json`` directly.

        data_source = GCSDataSource(bucket="my-gcs-bucket", blob="data/train.csv")
        data_source = GCSDataSource(bucket="my-gcs-bucket", blob="data/images/")
    """
    bucket: str
    blob: str                             # single blob name or prefix
    credentials_json: Optional[str] = None   # path to SA key file

    @property
    def source_type(self) -> str:
        return "gcs"

    async def load(self, **kwargs) -> bytes | List[bytes]:
        import asyncio
        try:
            from google.cloud import storage
            from google.oauth2 import service_account
        except ImportError:
            raise ImportError(
                "google-cloud-storage is required for GCSDataSource: "
                "pip install google-cloud-storage"
            )

        def _download():
            if self.credentials_json:
                creds = service_account.Credentials.from_service_account_file(self.credentials_json)
                client = storage.Client(credentials=creds)
            else:
                client = storage.Client()

            bucket = client.bucket(self.bucket)
            # Try single blob
            b = bucket.blob(self.blob)
            if b.exists():
                return b.download_as_bytes()
            # Prefix listing
            results = []
            for blob in client.list_blobs(self.bucket, prefix=self.blob):
                results.append(blob.download_as_bytes())
            return results

        return await asyncio.get_event_loop().run_in_executor(None, _download)

    def describe(self) -> Dict:
        return {"type": "gcs", "bucket": self.bucket, "blob": self.blob}


# ── Azure Blob Storage ────────────────────────────────────────────────────────

@dataclass
class AzureBlobDataSource(DataSource):
    """
    Download a blob or all blobs with a given prefix from Azure Blob Storage.

        data_source = AzureBlobDataSource(
            connection_string="DefaultEndpointsProtocol=https;...",
            container="training-data",
            blob="churn/train.csv",
        )
    """
    container: str
    blob: str                             # blob name or prefix
    connection_string: Optional[str] = None
    account_url: Optional[str] = None     # alternative to connection_string
    credential: Optional[str] = None      # SAS token or account key

    @property
    def source_type(self) -> str:
        return "azure_blob"

    async def load(self, **kwargs) -> bytes | List[bytes]:
        try:
            from azure.storage.blob.aio import BlobServiceClient
        except ImportError:
            raise ImportError(
                "azure-storage-blob is required for AzureBlobDataSource: "
                "pip install azure-storage-blob"
            )

        if self.connection_string:
            client = BlobServiceClient.from_connection_string(self.connection_string)
        else:
            client = BlobServiceClient(account_url=self.account_url, credential=self.credential)

        async with client:
            container_client = client.get_container_client(self.container)
            # Try single blob
            try:
                blob_client = container_client.get_blob_client(self.blob)
                stream = await blob_client.download_blob()
                return await stream.readall()
            except Exception:
                pass
            # Prefix listing
            results: List[bytes] = []
            async for item in container_client.list_blobs(name_starts_with=self.blob):
                bc = container_client.get_blob_client(item.name)
                stream = await bc.download_blob()
                results.append(await stream.readall())
            return results

    def describe(self) -> Dict:
        return {"type": "azure_blob", "container": self.container, "blob": self.blob}


# ── FTP / SFTP ────────────────────────────────────────────────────────────────

@dataclass
class FTPDataSource(DataSource):
    """
    Download a file from an FTP or SFTP server.

    Set ``use_sftp=True`` for SFTP (requires paramiko).

        data_source = FTPDataSource(
            host="ftp.example.com",
            path="/data/train.csv",
            username="user",
            password="pass",
        )
        data_source = FTPDataSource(
            host="sftp.example.com",
            path="/data/train.csv",
            username="user",
            private_key_path="/keys/id_rsa",
            use_sftp=True,
        )
    """
    host: str
    path: str
    username: str = "anonymous"
    password: str = ""
    port: Optional[int] = None
    use_sftp: bool = False
    private_key_path: Optional[str] = None

    @property
    def source_type(self) -> str:
        return "sftp" if self.use_sftp else "ftp"

    async def load(self, **kwargs) -> bytes:
        import asyncio
        import io

        def _download():
            buf = io.BytesIO()
            if self.use_sftp:
                try:
                    import paramiko
                except ImportError:
                    raise ImportError("paramiko is required for SFTP: pip install paramiko")
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                connect_kwargs: Dict = {
                    "hostname": self.host,
                    "username": self.username,
                    "port": self.port or 22,
                }
                if self.private_key_path:
                    connect_kwargs["key_filename"] = self.private_key_path
                else:
                    connect_kwargs["password"] = self.password
                ssh.connect(**connect_kwargs)
                sftp = ssh.open_sftp()
                sftp.getfo(self.path, buf)
                sftp.close()
                ssh.close()
            else:
                from ftplib import FTP
                ftp = FTP()
                ftp.connect(self.host, self.port or 21)
                ftp.login(self.username, self.password)
                ftp.retrbinary(f"RETR {self.path}", buf.write)
                ftp.quit()
            buf.seek(0)
            return buf.read()

        return await asyncio.get_event_loop().run_in_executor(None, _download)

    def describe(self) -> Dict:
        return {"type": self.source_type, "host": self.host, "path": self.path}


# ── Paginated REST API ────────────────────────────────────────────────────────

@dataclass
class PaginatedAPIDataSource(DataSource):
    """
    Fetch all pages from a paginated REST API and combine results.

    Supports two pagination styles:
      - page/per_page  (``pagination="page"``)
      - cursor/next    (``pagination="cursor"``, reads ``next_key`` from response)

        data_source = PaginatedAPIDataSource(
            url="https://api.example.com/records",
            headers={"Authorization": "Bearer TOKEN"},
            data_key="results",       # JSON key that holds the records list
            pagination="page",
            page_size=200,
        )
    """
    url: str
    headers: Dict[str, str] = field(default_factory=dict)
    params: Dict[str, Any] = field(default_factory=dict)
    data_key: str = "results"              # JSON key containing records
    pagination: str = "page"               # "page" | "cursor"
    page_param: str = "page"
    page_size_param: str = "per_page"
    page_size: int = 100
    cursor_param: str = "cursor"
    next_key: str = "next_cursor"          # response key holding the next cursor
    max_pages: int = 1000
    timeout: int = 30

    @property
    def source_type(self) -> str:
        return "paginated_api"

    async def load(self, **kwargs) -> List[Any]:
        import httpx
        all_records: List[Any] = []

        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            if self.pagination == "page":
                page = 1
                while page <= self.max_pages:
                    p = {**self.params, self.page_param: page, self.page_size_param: self.page_size}
                    resp = await client.get(self.url, headers=self.headers, params=p)
                    resp.raise_for_status()
                    data = resp.json()
                    records = data.get(self.data_key, data if isinstance(data, list) else [])
                    if not records:
                        break
                    all_records.extend(records)
                    page += 1
            else:  # cursor
                cursor: Optional[str] = None
                pages = 0
                while pages < self.max_pages:
                    p = {**self.params, self.page_size_param: self.page_size}
                    if cursor:
                        p[self.cursor_param] = cursor
                    resp = await client.get(self.url, headers=self.headers, params=p)
                    resp.raise_for_status()
                    data = resp.json()
                    records = data.get(self.data_key, data if isinstance(data, list) else [])
                    all_records.extend(records)
                    cursor = data.get(self.next_key)
                    pages += 1
                    if not cursor or not records:
                        break

        return all_records

    def describe(self) -> Dict:
        return {"type": "paginated_api", "url": self.url, "pagination": self.pagination}


# ── Redis ─────────────────────────────────────────────────────────────────────

@dataclass
class RedisDataSource(DataSource):
    """
    Read data from Redis — supports list, set, sorted-set, and key-pattern scans.

    ``data_type``:
      - ``"list"``        — LRANGE key 0 -1
      - ``"set"``         — SMEMBERS key
      - ``"zset"``        — ZRANGE key 0 -1 WITHSCORES
      - ``"pattern"``     — SCAN for all keys matching key as glob, GET each

        data_source = RedisDataSource(key="pms:training:events", data_type="list")
        data_source = RedisDataSource(key="pms:ml:*", data_type="pattern")
    """
    key: str
    data_type: str = "list"          # list | set | zset | pattern
    uri: Optional[str] = None        # defaults to REDIS_URL from settings
    decode: bool = True              # decode bytes to str

    @property
    def source_type(self) -> str:
        return "redis"

    async def load(self, **kwargs) -> List[Any]:
        import json
        try:
            import redis.asyncio as aioredis
        except ImportError:
            raise ImportError("redis[asyncio] is required for RedisDataSource")

        from app.core.config import settings as _s
        r = aioredis.from_url(self.uri or _s.REDIS_URL, decode_responses=self.decode)

        try:
            if self.data_type == "list":
                raw = await r.lrange(self.key, 0, -1)
            elif self.data_type == "set":
                raw = list(await r.smembers(self.key))
            elif self.data_type == "zset":
                raw = await r.zrange(self.key, 0, -1, withscores=True)
            elif self.data_type == "pattern":
                keys = [k async for k in r.scan_iter(self.key)]
                raw = []
                for k in keys:
                    v = await r.get(k)
                    if v is not None:
                        raw.append(v)
            else:
                raise ValueError(f"Unknown data_type '{self.data_type}'")
        finally:
            await r.aclose()

        # Attempt JSON decode of each item
        results: List[Any] = []
        for item in raw:
            try:
                results.append(json.loads(item) if isinstance(item, str) else item)
            except (json.JSONDecodeError, TypeError):
                results.append(item)
        return results

    def describe(self) -> Dict:
        return {"type": "redis", "key": self.key, "data_type": self.data_type}


# ── ML Dock built-in Dataset ──────────────────────────────────────────────────

@dataclass
class DatasetDataSource(DataSource):
    """
    Load training data from an ML Dock built-in dataset (DatasetProfile).

    Returns a list of dicts, one per entry:
      entry_id, field_id, field_label, field_type,
      text_value, file_url, file_mime, description,
      captured_at, collector_id, collector_name

        data_source = DatasetDataSource(dataset_id="<dataset_id>")
        data_source = DatasetDataSource(slug="churn-training-data")

    Set ``auto_create_spec`` to have the dataset created automatically when
    the slug is not found (happens on first training run for a new org):

        data_source = DatasetDataSource(
            slug="churn-training-data",
            auto_create_spec={
                "name": "Churn Training Data",
                "description": "...",
                "fields": [{"label": "Customer Data (CSV/Excel)", "type": "file", ...}],
            },
        )
    """
    dataset_id: str = ""
    org_id: Optional[str] = None        # injected at run time by training_service
    slug: Optional[str] = None          # look up by slug instead of id
    sample_csv_endpoint: Optional[str] = None  # included in describe() for UI
    auto_create_spec: Optional[Dict] = None    # dataset to create if slug not found
    allow_empty: bool = False           # if True, proceed with empty list when dataset has no entries

    @property
    def source_type(self) -> str:
        return "dataset"

    async def load(self, **kwargs) -> List[Dict]:
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.core.config import settings as _s
        from bson import ObjectId as BsonObjectId

        client = AsyncIOMotorClient(_s.MONGODB_URL)
        db = client[_s.MONGODB_DATABASE]
        try:
            # Resolve dataset by slug — always scoped to the caller's org.
            # System datasets (org_id="") are never queried directly during training;
            # the user must clone or reference a public dataset first, which creates
            # an org-scoped copy that is found here.
            if self.slug:
                org_filter = self.org_id if self.org_id else ""
                profile = await db["dataset_profiles"].find_one({
                    "slug": self.slug,
                    "org_id": org_filter,
                    "deleted_at": None,
                })
                if not profile:
                    if self.auto_create_spec:
                        # Only auto-create for system trainers (no org) or
                        # when the trainer declares its own dataset spec.
                        profile = await self._auto_create_dataset(db, self.slug, org_filter)
                    else:
                        raise ValueError(
                            f"Dataset with slug {self.slug!r} not found in your workspace. "
                            "Go to Datasets → Public and clone or reference it first."
                        )
                resolved_id = str(profile["_id"])
            else:
                try:
                    ds_filter: Dict = {"_id": BsonObjectId(self.dataset_id)}
                except Exception as exc:
                    raise ValueError(f"Invalid dataset_id: {self.dataset_id!r}") from exc

                profile = await db["dataset_profiles"].find_one(ds_filter)
                if not profile:
                    raise ValueError(f"Dataset {self.dataset_id!r} not found")
                resolved_id = self.dataset_id

            # Org scoping: system datasets (org_id="") are readable by all orgs.
            # A dataset owned by a different org is only accessible if it is public
            # OR if the caller has a reference/clone of it (resolved above).
            dataset_org_id = str(profile.get("org_id") or "")
            dataset_visibility = profile.get("visibility", "private")
            if self.org_id and dataset_org_id and dataset_org_id != self.org_id:
                if dataset_visibility != "public":
                    raise ValueError(
                        f"Dataset '{self.slug or self.dataset_id}' is private and belongs to another org. "
                        "Reference or clone it first to use it in your trainer."
                    )

            # For referenced datasets, resolve entries from the source dataset
            reference_type = profile.get("reference_type")
            if reference_type == "reference" and profile.get("source_dataset_id"):
                resolved_id = profile["source_dataset_id"]
            # For all other cases (own, clone, public direct) use resolved_id as-is

            # If the dataset has no fields but spec defines them, patch them in now
            if not profile.get("fields") and self.auto_create_spec:
                new_fields = self._build_fields_from_spec()
                if new_fields:
                    from app.utils.datetime import utc_now as _utc_now
                    await db["dataset_profiles"].update_one(
                        {"_id": profile["_id"]},
                        {"$set": {"fields": new_fields, "updated_at": _utc_now()}},
                    )
                    profile["fields"] = new_fields

            field_map = {f["id"]: f for f in profile.get("fields", [])}

            entries = await db["dataset_entries"].find(
                {"dataset_id": resolved_id}
            ).to_list(length=None)

            # If dataset is empty and allow_empty is True, return empty list without raising.
            # The trainer's train() is expected to handle an empty list gracefully.
            if not entries and self.allow_empty:
                return []
            if not entries and not self.allow_empty:
                raise ValueError(
                    f"Dataset '{self.slug or self.dataset_id}' has no entries. "
                    "Upload training data before running this trainer, or set allow_empty=True "
                    "on the DatasetDataSource if the trainer handles empty data."
                )

            collectors_raw = await db["dataset_collectors"].find(
                {"dataset_id": resolved_id}
            ).to_list(length=None)
            collectors = {str(c.get("id") or c.get("_id", "")): c.get("name", "") for c in collectors_raw}

            from app.utils.s3_url import generate_presigned_url as _presign

            results: List[Dict] = []
            for e in entries:
                field_meta = field_map.get(e.get("field_id", ""), {})
                # file_url is never persisted in MongoDB — generate it from file_key.
                # Trainers run server-side so the internal MinIO endpoint is reachable.
                file_key = e.get("file_key") or ""
                file_url = _presign(file_key) if file_key else None
                results.append({
                    "entry_id": str(e.get("_id", "")),
                    "field_id": e.get("field_id", ""),
                    "field_label": field_meta.get("label", ""),
                    "field_type": field_meta.get("type", "text"),
                    "text_value": e.get("text_value"),
                    "file_url": file_url,
                    "file_key": file_key,
                    "file_mime": e.get("file_mime"),
                    "description": e.get("description"),
                    "captured_at": str(e.get("captured_at", "")),
                    "collector_id": str(e.get("collector_id", "")),
                    "collector_name": collectors.get(str(e.get("collector_id", "")), ""),
                    "points_awarded": e.get("points_awarded", 0),
                })
            return results
        finally:
            client.close()

    def _build_fields_from_spec(self) -> List[Dict]:
        """Build a list of field dicts from auto_create_spec["fields"]."""
        import uuid as _uuid

        fields_raw = (self.auto_create_spec or {}).get("fields", [])
        fields = []
        for i, f in enumerate(fields_raw):
            fields.append({
                "id": str(_uuid.uuid4()),
                "label": f.get("label", "Data File"),
                "instruction": f.get("instruction", ""),
                "type": f.get("type", "file"),
                "capture_mode": f.get("capture_mode", "upload_only"),
                "required": f.get("required", True),
                "description_mode": "none",
                "description_presets": [],
                "description_required": False,
                "order": i,
                "repeatable": f.get("repeatable", False),
                "max_repeats": f.get("max_repeats", 0),
                "validation_model": None,
                "validation_labels": [],
                "validation_message": "",
            })
        return fields

    async def _auto_create_dataset(self, db, slug: str, org_id: str) -> Dict:
        """Create the dataset from auto_create_spec and return the new document."""
        from app.utils.datetime import utc_now as _utc_now
        from bson import ObjectId as _OID

        spec = self.auto_create_spec or {}
        fields = self._build_fields_from_spec()

        now = _utc_now()
        doc = {
            "_id": _OID(),
            "org_id": org_id,
            "name": spec.get("name", slug.replace("-", " ").title()),
            "slug": slug,
            "description": spec.get("description", ""),
            "category": spec.get("category", "training"),
            "fields": fields,
            "status": "active",
            "points_enabled": False,
            "points_per_entry": 1,
            "points_redemption_info": "",
            "created_by": "system",
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
        }
        await db["dataset_profiles"].insert_one(doc)
        return doc

    def describe(self) -> Dict:
        d: Dict = {"type": "dataset"}
        if self.slug:
            d["dataset_slug"] = self.slug
        elif self.dataset_id:
            d["dataset_id"] = self.dataset_id
        if self.sample_csv_endpoint:
            d["sample_csv_endpoint"] = self.sample_csv_endpoint
        if self.allow_empty:
            d["allow_empty"] = True
        return d


# ── URL Dataset (S3-cached, scheduler-refreshed) ──────────────────────────────

@dataclass
class UrlDatasetDataSource(DataSource):
    """
    Load training data from a URL that is fetched on a schedule and cached in S3.

    Follows the same ergonomics as DatasetDataSource — use ``slug`` + ``source_url``
    and the dataset is created automatically on the first training run for each org.
    It also appears in the Datasets UI so collectors can add manually labelled entries
    alongside the URL-fetched content.

    The source URL is **never** hit at training time — only the scheduler touches it.

    Basic usage (flat JSON / CSV / single file):

        data_source = UrlDatasetDataSource(
            slug="disposable-email-data",
            source_url="https://disposable.github.io/disposable-email-domains/domains.json",
            refresh_interval_hours=24,
        )

    With auto_create_spec (dataset visible in UI, collectors can add labelled entries):

        data_source = UrlDatasetDataSource(
            slug="disposable-email-data",
            source_url="https://disposable.github.io/disposable-email-domains/domains.json",
            refresh_interval_hours=24,
            allow_empty=True,
            auto_create_spec={
                "name": "Disposable Email Dataset",
                "description": "Optionally upload labelled emails to improve accuracy.",
                "fields": [
                    {"label": "Email",  "type": "text",   "required": True},
                    {"label": "Label",  "type": "select", "required": True,
                     "options": ["disposable", "legitimate"]},
                ],
            },
        )

    For JSON arrays of objects with a media URL field (image / video datasets):

        data_source = UrlDatasetDataSource(
            slug="cat-photos",
            source_url="https://example.com/cats.json",
            url_field="image_url",
            max_items=5000,
            refresh_interval_hours=168,
        )

    Change-detection hooks — fire when the URL content changes between refreshes:

        data_source = UrlDatasetDataSource(
            slug="fraud-labels",
            source_url="https://internal.example.com/labels/fraud.csv",
            refresh_interval_hours=6,
            on_change_retrain="fraud_detector",
            on_change_webhook_url="https://your-system.example.com/hooks/dataset-updated",
        )
    """
    name: str = ""
    slug: str = ""
    source_url: str = ""
    refresh_interval_hours: int = 24
    url_field: Optional[str] = None         # field in JSON objects holding a media URL
    max_items: Optional[int] = None
    allow_empty: bool = False
    auto_create_spec: Optional[Dict] = None
    on_change_webhook_url: Optional[str] = None
    on_change_retrain: Optional[str] = None
    # Legacy: direct source_id lookup (bypasses slug resolution)
    source_id: Optional[str] = None

    @property
    def source_type(self) -> str:
        return "url_dataset"

    async def load(self, **kwargs) -> Any:
        from app.models.url_dataset import UrlDataset
        from app.services.url_dataset_service import get_or_create_by_slug

        org_id: str = kwargs.get("org_id") or ""

        # Resolve by slug (standard path)
        if self.slug:
            if not self.source_url:
                raise ValueError(
                    f"UrlDatasetDataSource with slug={self.slug!r} requires source_url to be set."
                )
            src = await get_or_create_by_slug(
                slug=self.slug,
                org_id=org_id,
                source_url=self.source_url,
                refresh_interval_hours=self.refresh_interval_hours,
                url_field=self.url_field,
                max_items=self.max_items,
                on_change_webhook_url=self.on_change_webhook_url,
                on_change_retrain=self.on_change_retrain,
                auto_create_spec=self.auto_create_spec,
            )
        elif self.source_id:
            # Legacy direct ID path
            try:
                from beanie import PydanticObjectId
                src = await UrlDataset.find_one({
                    "_id": PydanticObjectId(self.source_id),
                    "deleted_at": None,
                })
            except Exception:
                src = None
            if not src:
                raise ValueError(f"URL dataset '{self.source_id}' not found")
        else:
            raise ValueError("UrlDatasetDataSource requires either slug or source_id")

        if src.status == "pending":
            # Dataset exists but was never fetched — run fetch now and wait for it.
           #  logger.info(f"[UrlDatasetDS] status=pending slug={src.slug!r} → triggering fetch")
            from app.services.url_dataset_service import fetch_and_store as _fetch
            await _fetch(str(src.id))
            # Reload after fetch
            if self.slug:
                from app.services.url_dataset_service import get_or_create_by_slug as _goc
                src = await _goc(
                    slug=self.slug, org_id=org_id, source_url=self.source_url,
                    refresh_interval_hours=self.refresh_interval_hours,
                    url_field=self.url_field, max_items=self.max_items,
                )
            else:
                src = await UrlDataset.get(str(src.id))

        if src.status != "ready":
           #  logger.info(f"[UrlDatasetDS] status={src.status!r} slug={src.slug!r} → returning []")
            if self.allow_empty:
                return []
            raise ValueError(
                f"URL dataset '{src.name}' is not ready yet (status={src.status}). "
                "The first fetch runs automatically — wait a moment and retry, "
                "or trigger it manually via POST /api/v1/url-datasets/{id}/refresh"
            )

       #  logger.info(f"[UrlDatasetDS] slug={src.slug!r} org_id={src.org_id!r} dataset_profile_id={src.dataset_profile_id!r}")

        # Return DB entries (same shape as DatasetDataSource) so preprocess() receives
        # a consistent list of dicts. The entry has field_id="source_data", file_key
        # pointing to the canonical S3 file. Users call load_from_s3_sync() themselves
        # inside preprocess() if they need the raw file content.
        from motor.motor_asyncio import AsyncIOMotorClient
        from app.core.config import settings as _s
        from app.utils.s3_url import generate_presigned_url as _presign

        client = AsyncIOMotorClient(_s.MONGODB_URL)
        db = client[_s.MONGODB_DATABASE]
        try:
            # Resolve profile by slug (same pattern as DatasetDataSource).
            # Fall back to dataset_profile_id if slug is absent.
            if src.slug:
                profile = await db["dataset_profiles"].find_one({
                    "slug": src.slug,
                    "org_id": src.org_id,
                    "deleted_at": None,
                })
               #  logger.info(f"[UrlDatasetDS] profile by slug={src.slug!r}: {profile and str(profile['_id'])}")
            elif src.dataset_profile_id:
                from bson import ObjectId as _BsonOID
                try:
                    profile = await db["dataset_profiles"].find_one({
                        "_id": _BsonOID(src.dataset_profile_id),
                        "deleted_at": None,
                    })
                except Exception:
                    profile = None
               #  logger.info(f"[UrlDatasetDS] profile by id={src.dataset_profile_id!r}: {profile and str(profile['_id'])}")
            else:
                profile = None
               #  logger.info(f"[UrlDatasetDS] no slug or dataset_profile_id → profile=None")

            if not profile:
                if self.allow_empty:
                    return []
                raise ValueError(
                    f"URL dataset '{src.name}' has no companion dataset profile. "
                    "Trigger a refresh to create it."
                )

            resolved_id = str(profile["_id"])
            field_map = {f["id"]: f for f in profile.get("fields", [])}

            entries = await db["dataset_entries"].find(
                {"dataset_id": resolved_id, "file_key": {"$exists": True, "$ne": ""}}
            ).to_list(length=None)

            if not entries:
                if self.allow_empty:
                    return []
                raise ValueError(
                    f"URL dataset '{src.name}' has no entries yet. "
                    "Trigger a refresh to populate it."
                )

            results = []
            for e in entries:
                field_meta = field_map.get(e.get("field_id", ""), {})
                file_key = e.get("file_key") or ""
                file_url = _presign(file_key) if file_key else None
                results.append({
                    "entry_id": str(e.get("_id", "")),
                    "field_id": e.get("field_id", ""),
                    "field_label": field_meta.get("label", "Source Data"),
                    "field_type": field_meta.get("type", "file"),
                    "text_value": e.get("text_value"),
                    "file_url": file_url,
                    "file_key": file_key,
                    "file_mime": e.get("file_mime"),
                    "file_size_bytes": e.get("file_size_bytes"),
                    "description": e.get("description"),
                    "captured_at": str(e.get("captured_at", "")),
                    "collector_id": str(e.get("collector_id", "")),
                })
            return results
        finally:
            client.close()

    def describe(self) -> Dict:
        d: Dict = {"type": "url_dataset"}
        if self.slug:
            d["slug"] = self.slug
            d["source_url"] = self.source_url
        elif self.source_id:
            d["source_id"] = self.source_id
        if self.refresh_interval_hours != 24:
            d["refresh_interval_hours"] = self.refresh_interval_hours
        if self.url_field:
            d["url_field"] = self.url_field
        if self.allow_empty:
            d["allow_empty"] = True
        return d
