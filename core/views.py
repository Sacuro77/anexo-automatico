from django.http import JsonResponse
from django.shortcuts import render


def health(_request):
    return JsonResponse({"status": "ok"})


def home(request):
    return render(request, "landing.html")
