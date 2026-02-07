from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("", include("core.urls")),
    path("ingesta/", include("ingesta.urls")),
    path("admin/", admin.site.urls),
]
