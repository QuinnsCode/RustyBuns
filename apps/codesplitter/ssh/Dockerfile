# The git container behind codeSplitter's ssh spike (#5500): sshd on 2222, one `git` user whose every login runs
# git-serve.sh, so all a key can do is fetch from or push to /srv/git/<owner>/<repo>.git.
FROM alpine:3.20
RUN apk add --no-cache openssh-server git \
 && adduser -D -s /bin/sh git && passwd -u git \
 && ssh-keygen -A \
 && mkdir -p /home/git/.ssh /srv/git && chown -R git:git /home/git /srv/git
COPY entry.sh git-serve.sh /
RUN chmod 755 /entry.sh /git-serve.sh
EXPOSE 2222
CMD ["sh", "/entry.sh"]
