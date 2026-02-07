
def test_home(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Anexo Automático" in response.content.decode("utf-8")
