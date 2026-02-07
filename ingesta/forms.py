from django import forms


class ImportacionUploadForm(forms.Form):
    archivo = forms.FileField(label="Archivo ZIP")

    def clean_archivo(self):
        archivo = self.cleaned_data["archivo"]
        if not archivo.name.lower().endswith(".zip"):
            raise forms.ValidationError("El archivo debe ser un .zip")
        return archivo
