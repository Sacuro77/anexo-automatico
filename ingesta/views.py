from django.contrib import messages
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from ingesta.forms import ImportacionUploadForm
from ingesta.models import Importacion
from ingesta.services.s3_client import ensure_bucket, upload_zip
from ingesta.tasks import process_zip_import


@require_http_methods(["GET", "POST"])
def index(request):
    if request.method == "POST":
        form = ImportacionUploadForm(request.POST, request.FILES)
        if form.is_valid():
            importacion = Importacion.objects.create()
            key = f"imports/{importacion.id}/source.zip"
            try:
                ensure_bucket()
                uploaded = form.cleaned_data["archivo"]
                uploaded.seek(0)
                upload_zip(uploaded, key)
            except Exception as exc:
                importacion.status = Importacion.Status.FAILED
                importacion.finished_at = timezone.now()
                importacion.error_count = 1
                importacion.error_summary = str(exc)
                importacion.save()
                messages.error(request, "No se pudo subir el ZIP.")
                return redirect("ingesta-detail", importacion_id=importacion.id)

            importacion.s3_key_zip = key
            importacion.save(update_fields=["s3_key_zip"])
            process_zip_import.delay(importacion.id)
            messages.success(request, "Importación encolada.")
            return redirect("ingesta-detail", importacion_id=importacion.id)
    else:
        form = ImportacionUploadForm()

    importaciones = Importacion.objects.order_by("-created_at")[:20]
    return render(
        request,
        "ingesta/index.html",
        {"form": form, "importaciones": importaciones},
    )


def importacion_list(request):
    importaciones = Importacion.objects.order_by("-created_at")
    return render(
        request,
        "ingesta/list.html",
        {"importaciones": importaciones},
    )


def importacion_detail(request, importacion_id: int):
    importacion = get_object_or_404(Importacion, id=importacion_id)
    return render(
        request,
        "ingesta/detail.html",
        {"importacion": importacion},
    )
