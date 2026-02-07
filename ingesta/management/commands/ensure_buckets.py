from django.core.management.base import BaseCommand

from ingesta.services.s3_client import ensure_bucket


class Command(BaseCommand):
    help = "Ensure S3 bucket exists for ingesta imports."

    def handle(self, *args, **options):
        ensure_bucket()
        self.stdout.write(self.style.SUCCESS("Bucket ensured."))
