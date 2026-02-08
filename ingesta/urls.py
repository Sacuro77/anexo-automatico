from django.urls import path

from ingesta import views

urlpatterns = [
    path("", views.index, name="ingesta-index"),
    path("importaciones/", views.importacion_list, name="ingesta-list"),
    path("revisar/", views.revisar, name="ingesta-revisar"),
    path(
        "importaciones/<int:importacion_id>/",
        views.importacion_detail,
        name="ingesta-detail",
    ),
]
