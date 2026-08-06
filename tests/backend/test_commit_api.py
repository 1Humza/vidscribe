import subprocess
from pathlib import Path

from fastapi.testclient import TestClient

from vidscribe.app import create_app
from vidscribe.config import Settings
from vidscribe.finalization import SessionFinalizer


def make_recording(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(path),
        ],
        check=True,
    )


def create_reviewed_session(client: TestClient) -> tuple[str, str]:
    source = client.post("/api/pickers/source", json={}).json()
    destination = client.post("/api/pickers/destination", json={}).json()
    created = client.post(
        "/api/sessions",
        json={
            "source_selection_id": source["selection_id"],
            "destination_selection_id": destination["selection_id"],
        },
    )
    assert created.status_code == 201
    session_id = created.json()["id"]
    assert client.post(f"/api/sessions/{session_id}/execute").status_code == 200
    attempt_id = client.get(f"/api/sessions/{session_id}").json()["attempts"][0]["id"]
    return session_id, attempt_id


def test_commit_publishes_one_verified_completed_session_folder(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")
        restored = client.get(f"/api/sessions/{session_id}")

    assert committed.status_code == 200
    payload = committed.json()
    assert payload["status"] == "completed"
    assert payload["stage"] == "completed"
    assert restored.json()["status"] == "completed"
    assert restored.json()["completed_folder_path"] == payload["completed_folder_path"]
    completed_folder = destination / "2026-07-31-pipeline-test-sync"
    assert sorted(path.name for path in completed_folder.iterdir()) == [
        "2026-07-31-pipeline-test-sync.24k.ogg",
        "2026-07-31-pipeline-test-sync.md",
        "2026-07-31-pipeline-test-sync.wav",
    ]
    assert "## Recall Brief" in (completed_folder / "2026-07-31-pipeline-test-sync.md").read_text()
    assert (completed_folder / "2026-07-31-pipeline-test-sync.24k.ogg").is_file()
    assert not source.exists()
    assert payload["source_path"] == str(
        (completed_folder / "2026-07-31-pipeline-test-sync.wav").resolve()
    )
    assert payload["attempts"][0]["raw_stream"] == ""


def test_commit_marks_existing_completed_folder_as_needing_attention(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    conflict = destination / "2026-07-31-pipeline-test-sync"
    conflict.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 200
    assert committed.json()["status"] == "needs_attention"
    assert source.is_file()
    assert list(conflict.iterdir()) == []


def test_recommit_renames_completed_assets_after_a_session_date_correction(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        assert client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit").status_code == 200
        corrected = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"session_date": "2026-08-01"},
        )
        recommitted = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert corrected.status_code == 200
    assert recommitted.status_code == 200
    completed_folder = destination / "2026-08-01-pipeline-test-sync"
    assert not (destination / "2026-07-31-pipeline-test-sync").exists()
    assert sorted(path.name for path in completed_folder.iterdir()) == [
        "2026-08-01-pipeline-test-sync.24k.ogg",
        "2026-08-01-pipeline-test-sync.md",
        "2026-08-01-pipeline-test-sync.wav",
    ]
    assert recommitted.json()["completed_folder_path"] == str(completed_folder.resolve())


def test_commit_restores_source_when_same_volume_publication_fails(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    import vidscribe.finalization as finalization

    def fail_publish(staging: Path, completed: Path) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(finalization, "_publish_no_replace", fail_publish)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert source.is_file()
    assert not (destination / "2026-07-31-pipeline-test-sync").exists()
    assert not list(destination.glob(".*.staging-*"))


def test_commit_keeps_source_when_cross_volume_cleanup_fails(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )
    original_unlink = Path.unlink

    def fail_source_delete(path: Path, *args, **kwargs) -> None:
        if path == source:
            raise OSError("source is busy")
        original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_source_delete)
    finalizer = SessionFinalizer(same_volume=lambda _source, _destination: False)
    with TestClient(create_app(settings, finalizer=finalizer)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert committed.json()["detail"] == "Could not safely finalize this Session"
    assert source.is_file()
    assert (destination / "2026-07-31-pipeline-test-sync").is_dir()


def test_commit_cleans_staging_when_session_record_write_fails(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    original_write_text = Path.write_text

    def fail_staged_record(path: Path, *args, **kwargs) -> int:
        if path.name.endswith(".md") and ".staging-" in str(path.parent):
            raise OSError("destination is read-only")
        return original_write_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", fail_staged_record)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert source.is_file()
    assert not list(destination.iterdir())


def test_commit_cleans_staging_when_session_record_verification_fails(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    original_read_text = Path.read_text

    def corrupt_staged_read(path: Path, *args, **kwargs) -> str:
        if path.name.endswith(".md") and ".staging-" in str(path.parent):
            return "corrupted"
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", corrupt_staged_read)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert source.is_file()
    assert not list(destination.iterdir())


def test_commit_cleans_staging_when_analysis_audio_copy_fails(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    import vidscribe.finalization as finalization

    original_copy = finalization.shutil.copy2

    def fail_audio_copy(original: Path, copied: Path, *args, **kwargs) -> Path:
        if original.name == "analysis.24k.ogg":
            raise OSError("disk full")
        return original_copy(original, copied, *args, **kwargs)

    monkeypatch.setattr(finalization.shutil, "copy2", fail_audio_copy)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert source.is_file()
    assert not list(destination.iterdir())


def test_commit_restores_source_when_source_transfer_verification_fails(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    import vidscribe.finalization as finalization

    original_hash = finalization._file_hash

    def corrupt_staged_source_hash(path: Path) -> str:
        if path.name.endswith(".wav") and ".staging-" in str(path.parent):
            return "wrong-hash"
        return original_hash(path)

    monkeypatch.setattr(finalization, "_file_hash", corrupt_staged_source_hash)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert source.is_file()
    assert not list(destination.iterdir())


def test_commit_keeps_source_when_same_volume_transfer_fails(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    import vidscribe.finalization as finalization

    original_replace = finalization.os.replace

    def fail_source_transfer(original: Path, copied: Path) -> None:
        if copied.name.endswith(".wav") and ".staging-" in str(copied.parent):
            raise OSError("source is busy")
        original_replace(original, copied)

    monkeypatch.setattr(finalization.os, "replace", fail_source_transfer)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 422
    assert source.is_file()
    assert not list(destination.iterdir())


def test_commit_never_replaces_a_destination_created_during_publication(
    tmp_path: Path, monkeypatch
) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )
    import vidscribe.finalization as finalization

    original_publish = finalization._publish_no_replace

    def create_competing_folder(staging: Path, completed: Path) -> None:
        completed.mkdir()
        original_publish(staging, completed)

    monkeypatch.setattr(finalization, "_publish_no_replace", create_competing_folder)
    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert committed.status_code == 200
    assert committed.json()["status"] == "needs_attention"
    assert source.is_file()
    assert list((destination / "2026-07-31-pipeline-test-sync").iterdir()) == []


def test_restart_recovers_a_folder_published_before_session_completion(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        session_id, attempt_id = create_reviewed_session(client)
        finalizing = app.state.sessions.claim_commit(
            session_id, attempt_id, service_id=app.state.service_id, cross_volume=False
        ).session
        attempt = finalizing.attempts[0]
        assert attempt.result is not None
        SessionFinalizer().finalize(finalizing, attempt.result)
        assert app.state.sessions.get(session_id).attempts[0].status == "completed"

    with TestClient(create_app(settings)) as restarted_client:
        recovered = restarted_client.post(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/commit"
        )

    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["status"] == "completed"
    assert recovered.json()["completed_folder_path"] == str(
        (destination / "2026-07-31-pipeline-test-sync").resolve()
    )


def test_live_duplicate_commit_reports_in_progress_without_changing_the_session(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    app = create_app(settings)
    with TestClient(app) as client:
        session_id, attempt_id = create_reviewed_session(client)
        app.state.sessions.claim_commit(
            session_id, attempt_id, service_id=app.state.service_id, cross_volume=False
        )
        duplicate = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")
        restored = client.get(f"/api/sessions/{session_id}")

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Session commit is already in progress"
    assert restored.json()["status"] == "finalizing"


def test_restart_removes_cross_volume_source_after_publishing(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    finalizer = SessionFinalizer(same_volume=lambda _source, _destination: False)
    app = create_app(settings, finalizer=finalizer)
    original_unlink = Path.unlink

    def fail_source_delete(path: Path, *args, **kwargs) -> None:
        if path == source:
            raise OSError("source is busy")
        original_unlink(path, *args, **kwargs)

    with TestClient(app) as client:
        session_id, attempt_id = create_reviewed_session(client)
        finalizing = app.state.sessions.claim_commit(
            session_id, attempt_id, service_id=app.state.service_id, cross_volume=True
        ).session
        attempt = finalizing.attempts[0]
        assert attempt.result is not None
        with monkeypatch.context() as temporary_patch:
            temporary_patch.setattr(Path, "unlink", fail_source_delete)
            try:
                finalizer.finalize(finalizing, attempt.result)
            except Exception:
                pass

    with TestClient(create_app(settings, finalizer=finalizer)) as restarted_client:
        recovered = restarted_client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert recovered.status_code == 200
    assert recovered.json()["status"] == "completed"
    assert not source.exists()


def test_restart_preserves_replacement_at_cross_volume_source_path(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)
    finalizer = SessionFinalizer(same_volume=lambda _source, _destination: False)
    app = create_app(settings, finalizer=finalizer)
    original_unlink = Path.unlink

    def fail_source_delete(path: Path, *args, **kwargs) -> None:
        if path == source:
            raise OSError("source is busy")
        original_unlink(path, *args, **kwargs)

    with TestClient(app) as client:
        session_id, attempt_id = create_reviewed_session(client)
        finalizing = app.state.sessions.claim_commit(
            session_id, attempt_id, service_id=app.state.service_id, cross_volume=True
        ).session
        attempt = finalizing.attempts[0]
        assert attempt.result is not None
        with monkeypatch.context() as temporary_patch:
            temporary_patch.setattr(Path, "unlink", fail_source_delete)
            try:
                finalizer.finalize(finalizing, attempt.result)
            except Exception:
                pass
    source.write_bytes(b"a different recording")

    with TestClient(create_app(settings, finalizer=finalizer)) as restarted_client:
        recovered = restarted_client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert recovered.status_code == 422
    assert source.read_bytes() == b"a different recording"


def test_completed_session_identity_edits_rename_its_saved_assets(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(
        data_dir=tmp_path / "data",
        test_mode=True,
        test_source_path=source,
        test_destination_path=destination,
    )

    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        first_commit = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")
        second_commit = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")
        review_edit = client.patch(
            f"/api/sessions/{session_id}/attempts/{attempt_id}/review",
            json={"short_name": "Changed after completion"},
        )
        saved_edit = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")

    assert first_commit.status_code == 200
    assert second_commit.status_code == 200
    assert second_commit.json()["completed_folder_path"] == first_commit.json()["completed_folder_path"]
    assert review_edit.status_code == 200
    assert saved_edit.status_code == 200
    completed_folder = Path(saved_edit.json()["completed_folder_path"])
    record = completed_folder / "2026-07-31-changed-after-completion.md"
    assert "Changed after completion" in record.read_text()
    assert not Path(first_commit.json()["completed_folder_path"]).exists()
    assert Path(saved_edit.json()["source_path"]).is_file()


def test_completed_session_folder_selection_reopens_its_saved_record(tmp_path: Path) -> None:
    source = tmp_path / "2026-07-31-recording.wav"
    make_recording(source)
    destination = tmp_path / "destination"
    destination.mkdir()
    settings = Settings(data_dir=tmp_path / "data", test_mode=True, test_source_path=source, test_destination_path=destination)

    with TestClient(create_app(settings)) as client:
        session_id, attempt_id = create_reviewed_session(client)
        committed = client.post(f"/api/sessions/{session_id}/attempts/{attempt_id}/commit")
    completed_folder = Path(committed.json()["completed_folder_path"])
    settings.test_source_path = completed_folder

    with TestClient(create_app(settings)) as client:
        selection = client.post("/api/pickers/source", json={}).json()
        reopened = client.post("/api/sessions/open-completed", json={"source_selection_id": selection["selection_id"]})

    assert selection["media_kind"] is None
    assert reopened.status_code == 200
    assert reopened.json()["id"] == session_id
    assert reopened.json()["status"] == "completed"
