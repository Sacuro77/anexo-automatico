from __future__ import annotations

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from django.conf import settings


def get_client():
    endpoint_url = settings.S3_ENDPOINT_URL or None
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        use_ssl=settings.S3_USE_SSL,
        config=Config(s3={"addressing_style": "path"}),
    )


def ensure_bucket() -> None:
    client = get_client()
    bucket = settings.S3_BUCKET_NAME
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code in {"404", "NoSuchBucket", "NotFound"}:
            client.create_bucket(Bucket=bucket)
        else:
            raise


def upload_xml(xml_bytes: bytes, key: str) -> str:
    client = get_client()
    client.put_object(
        Bucket=settings.S3_BUCKET_NAME,
        Key=key,
        Body=xml_bytes,
        ContentType="application/xml",
    )
    return key


def upload_zip(fileobj, key: str) -> str:
    client = get_client()
    client.upload_fileobj(
        fileobj,
        settings.S3_BUCKET_NAME,
        key,
        ExtraArgs={"ContentType": "application/zip"},
    )
    return key


def download_bytes(key: str) -> bytes:
    client = get_client()
    response = client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=key)
    return response["Body"].read()
