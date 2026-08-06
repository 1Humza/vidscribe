# Finalize Sessions through destination-local staging

Vidscribe materializes every completed asset in a unique hidden staging directory inside the selected Destination, verifies those assets, transfers and verifies Source Media last, then atomically renames the staging directory to the approved Completed Session Folder. Cross-volume source transfers use copy, verification, publication, and source deletion in that order; the source is never deleted before the complete final folder is durably visible.
